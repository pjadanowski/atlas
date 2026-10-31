<?php

namespace Pjadanowski\Atlas\Tests;

use Dedoc\Scramble\ScrambleServiceProvider;
use Pjadanowski\Atlas\AtlasServiceProvider;
use Orchestra\Testbench\TestCase;

/**
 * `--allow-spec-html` decides per description, not per site: a spec mixes
 * HTML-authored descriptions with markdown-authored ones, and the flag must not
 * push the markdown ones through verbatim — that would print their `**` and
 * `###` as literal text.
 *
 * A separate class because Scramble snapshots `scramble.info.description` while
 * booting, so a markdown fixture cannot coexist with the HTML one.
 */
class MarkdownDescriptionTest extends TestCase
{
    private string $output;

    protected function getPackageProviders($app): array
    {
        return [ScrambleServiceProvider::class, AtlasServiceProvider::class];
    }

    protected function defineEnvironment($app): void
    {
        $this->output = sys_get_temp_dir().'/atlas-markdown';
        $app['config']->set('app.key', 'base64:'.base64_encode(random_bytes(32)));
        $app['config']->set('scramble.renderer', 'atlas');
        $app['config']->set('atlas.output', $this->output);
        $app['config']->set('scramble.info.description', "## Important\n\nA **bold** note.");
    }

    protected function defineRoutes($router): void
    {
        $router->middleware('api')->prefix('api')->group(function ($router) {
            $router->get('/widgets', fn () => ['data' => []]);
        });
    }

    public function test_markdown_descriptions_still_render_as_markdown_when_spec_html_is_allowed(): void
    {
        $this->artisan('atlas:build --allow-spec-html')->assertSuccessful();
        $html = file_get_contents($this->output.'/index.html');

        $this->assertStringContainsString('<strong>bold</strong>', $html);
        $this->assertStringContainsString('<h3 class="md-heading" id="intro-important">Important</h3>', $html);
        // The giveaway of a markdown description pushed through verbatim.
        $this->assertStringNotContainsString('**bold**', $html);
        $this->assertStringNotContainsString('## Important', $html);
    }
}
