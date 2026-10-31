<?php

namespace Pjadanowski\Atlas\Tests;

use Dedoc\Scramble\Scramble;
use Dedoc\Scramble\ScrambleServiceProvider;
use Pjadanowski\Atlas\AtlasServiceProvider;
use Pjadanowski\Atlas\Support\DocsLocation;
use Illuminate\Support\Facades\Gate;
use Orchestra\Testbench\TestCase;

/**
 * End-to-end check of pjadanowski/atlas inside a real booted Laravel app,
 * with the real dedoc/scramble installed.
 */
class IntegrationTest extends TestCase
{
    private string $output;

    protected function getPackageProviders($app): array
    {
        return [ScrambleServiceProvider::class, AtlasServiceProvider::class];
    }

    protected function defineEnvironment($app): void
    {
        $this->output = sys_get_temp_dir().'/atlas-integration';
        $app['config']->set('app.key', 'base64:'.base64_encode(random_bytes(32)));
        $app['config']->set('scramble.renderer', 'atlas');
        $app['config']->set('atlas.output', $this->output);
        // Scramble snapshots its config while booting, so this has to be set
        // here rather than inside a test.
        $app['config']->set('scramble.info.description', '<h2>Heading</h2><ul><li>Item</li></ul>');
    }

    protected function defineRoutes($router): void
    {
        // Something for Scramble to document, so the spec is not empty.
        $router->middleware('api')->prefix('api')->group(function ($router) {
            $router->get('/widgets', fn () => ['data' => []]);
            $router->post('/widgets', fn () => ['data' => []]);
        });
    }

    public function test_package_registers_itself_as_a_scramble_renderer(): void
    {
        $this->assertSame('atlas::docs', config('scramble.renderers.atlas.view'));

        // The contract that actually matters: Scramble resolving to our view.
        $this->assertSame(
            'atlas::docs',
            Scramble::getGeneratorConfig('default')->renderer()->view,
        );
    }

    public function test_it_detects_where_scramble_mounted_the_docs(): void
    {
        $location = $this->app->make(DocsLocation::class);

        $this->assertSame('docs/api', $location->routePrefix());
        $this->assertSame('/docs/api', $location->base());
    }

    public function test_generated_assets_inherit_scrambles_access_restriction(): void
    {
        $this->artisan('atlas:build')->assertSuccessful();

        // Environment is "testing" and no viewApiDocs gate is defined, so
        // RestrictedDocsAccess must reject both Scramble's page and our assets.
        $this->get('/docs/api')->assertForbidden();
        $this->get('/docs/api/assets/fonts/instrument-sans.woff2')->assertForbidden();
    }

    public function test_it_builds_and_serves_the_documentation(): void
    {
        // Optional parameter, otherwise the gate never runs for a guest.
        Gate::define('viewApiDocs', fn ($user = null) => true);

        $this->artisan('atlas:build')->assertSuccessful();

        $index = $this->output.'/index.html';
        $this->assertFileExists($index);

        $html = file_get_contents($index);
        $this->assertStringContainsString('href="/docs/api/', $html);
        $this->assertDoesNotMatchRegularExpression('~(href|src)="/assets/~', $html);

        // Scramble's own UI route hands back the generated entry page.
        $page = $this->get('/docs/api');
        $page->assertOk();
        $this->assertStringContainsString('nav-tree', $page->getContent());

        // The package's catch-all serves everything below the prefix.
        preg_match('~/docs/api/assets/app\.[0-9a-f]{8}\.css~', $html, $match);
        $this->assertNotEmpty($match, 'no fingerprinted stylesheet in the page');
        $this->get($match[0])->assertOk();

        $this->get('/docs/api/assets/fonts/instrument-sans.woff2')->assertOk();
        $this->get('/docs/api/openapi.json')->assertOk();

        // Each documented endpoint became its own page.
        $this->get('/docs/api/sonstige/get-widgets/')->assertOk();
        $this->get('/docs/api/sonstige/post-widgets/')->assertOk();
    }

    public function test_the_documentation_is_also_an_mcp_server(): void
    {
        Gate::define('viewApiDocs', fn ($user = null) => true);
        $this->artisan('atlas:build')->assertSuccessful();

        // Stateless Streamable HTTP: no server stream, so GET is refused.
        $this->get('/docs/api/mcp')->assertStatus(405);

        $this->postJson('/docs/api/mcp', $this->rpc(1, 'initialize', [
            'protocolVersion' => '2025-06-18', 'capabilities' => [], 'clientInfo' => ['name' => 'test', 'version' => '0'],
        ]))
            ->assertOk()
            ->assertJsonPath('result.protocolVersion', '2025-06-18')
            ->assertJsonPath('result.serverInfo.name', 'atlas-docs');

        // Notifications are acknowledged without a body.
        $this->postJson('/docs/api/mcp', ['jsonrpc' => '2.0', 'method' => 'notifications/initialized'])->assertStatus(202);

        $tools = $this->postJson('/docs/api/mcp', $this->rpc(2, 'tools/list'))->assertOk()->json('result.tools.*.name');
        $this->assertSame(['search_api', 'list_endpoints', 'get_endpoint', 'get_model'], $tools);

        // Typo tolerant: "widgts" still finds the widgets endpoints.
        $found = $this->postJson('/docs/api/mcp', $this->rpc(3, 'tools/call', [
            'name' => 'search_api', 'arguments' => ['query' => 'widgts'],
        ]))->assertOk()->json('result.content.0.text');
        $this->assertStringContainsString('widgets', $found);
        $this->assertStringContainsString('http://localhost/docs/api/sonstige/', $found);

        $index = json_decode(file_get_contents($this->output.'/assets/search-index.json'), true);
        $endpoint = collect($index)->firstWhere('m', 'GET');
        $page = $this->postJson('/docs/api/mcp', $this->rpc(4, 'tools/call', [
            'name' => 'get_endpoint', 'arguments' => ['method' => 'get', 'path' => $endpoint['p']],
        ]))->assertOk()->json('result.content.0.text');
        $this->assertStringContainsString('`GET '.$endpoint['p'].'`', $page);
        $this->assertStringContainsString('Page: http://localhost'.$endpoint['h'], $page);

        $this->postJson('/docs/api/mcp', $this->rpc(5, 'tools/call', ['name' => 'get_model', 'arguments' => ['name' => 'Nope']]))
            ->assertOk()
            ->assertJsonPath('result.isError', true);

        $this->postJson('/docs/api/mcp', $this->rpc(6, 'no/such'))->assertOk()->assertJsonPath('error.code', -32601);

        // The page advertises the endpoint to readers.
        $html = file_get_contents($this->output.'/index.html');
        $this->assertStringContainsString('data-mcp-dialog', $html);
        $this->assertStringContainsString('/docs/api/mcp', $html);
    }

    public function test_the_mcp_endpoint_inherits_scrambles_access_restriction(): void
    {
        $this->artisan('atlas:build')->assertSuccessful();

        $this->postJson('/docs/api/mcp', $this->rpc(1, 'tools/list'))->assertForbidden();
    }

    /** @return array<string, mixed> */
    private function rpc(int $id, string $method, array $params = []): array
    {
        return ['jsonrpc' => '2.0', 'id' => $id, 'method' => $method, 'params' => $params];
    }

    public function test_specification_html_is_escaped_unless_explicitly_allowed(): void
    {
        $this->artisan('atlas:build')->assertSuccessful();
        $this->assertStringContainsString('&lt;h2&gt;', file_get_contents($this->output.'/index.html'));

        $this->artisan('atlas:build --allow-spec-html')->assertSuccessful();
        $html = file_get_contents($this->output.'/index.html');
        $this->assertStringContainsString('<h2>Heading</h2>', $html);
        $this->assertStringContainsString('spec-html', $html);
    }

    public function test_it_injects_custom_stylesheets_and_scripts(): void
    {
        Gate::define('viewApiDocs', fn ($user = null) => true);

        $css = sys_get_temp_dir().'/atlas-custom.css';
        $js = sys_get_temp_dir().'/atlas-custom.js';
        file_put_contents($css, '.topbar-title { color: #e0245e; }');
        file_put_contents($js, 'window.atlasCustom = true;');
        config(['atlas.css' => [$css], 'atlas.js' => [$js]]);

        $this->artisan('atlas:build')->assertSuccessful();

        $html = file_get_contents($this->output.'/index.html');
        $this->assertMatchesRegularExpression('~<link rel="stylesheet" href="[^"]*/custom\.[0-9a-f]{8}\.css">~', $html);
        $this->assertMatchesRegularExpression('~<script src="[^"]*/custom\.[0-9a-f]{8}\.js" defer></script>~', $html);

        // Loaded after Atlas's own bundles, otherwise overriding would not work.
        $this->assertGreaterThan(
            strpos($html, '/assets/app.'),
            strpos($html, '/assets/custom.'),
        );

        // The route serves it, and what it serves is the file we passed in.
        // (assertSee is useless here: a BinaryFileResponse has no content.)
        preg_match('~/docs/api/assets/(custom\.[0-9a-f]{8}\.css)~', $html, $match);
        $this->get($match[0])->assertOk();
        $this->assertStringContainsString('#e0245e', file_get_contents($this->output.'/assets/'.$match[1]));
    }

    public function test_it_refuses_to_serve_files_outside_the_output_directory(): void
    {
        // Access granted, so a 404 proves the controller rejected the path
        // rather than the middleware rejecting the request.
        Gate::define('viewApiDocs', fn ($user = null) => true);

        $this->artisan('atlas:build')->assertSuccessful();

        $this->get('/docs/api/assets/../../../../../../etc/passwd')->assertNotFound();
    }
}
