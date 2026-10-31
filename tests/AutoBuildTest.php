<?php

namespace Pjadanowski\Atlas\Tests;

use Dedoc\Scramble\ScrambleServiceProvider;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Gate;
use Orchestra\Testbench\TestCase;
use Pjadanowski\Atlas\AtlasServiceProvider;
use Pjadanowski\Atlas\Support\SiteBuilder;

/**
 * The development loop: with `atlas.auto_build` on, opening the docs builds
 * them, and they are rebuilt only when what they are built from changes.
 */
class AutoBuildTest extends TestCase
{
    private string $output;

    protected function getPackageProviders($app): array
    {
        return [ScrambleServiceProvider::class, AtlasServiceProvider::class];
    }

    protected function defineEnvironment($app): void
    {
        $this->output = sys_get_temp_dir().'/atlas-autobuild';
        File::deleteDirectory($this->output);
        $app['config']->set('app.key', 'base64:'.base64_encode(random_bytes(32)));
        $app['config']->set('scramble.renderer', 'atlas');
        $app['config']->set('atlas.output', $this->output);
        $app['config']->set('atlas.auto_build', true);
    }

    protected function defineRoutes($router): void
    {
        $router->middleware('api')->prefix('api')->group(function ($router) {
            $router->get('/widgets', fn () => ['data' => []]);
        });
    }

    protected function setUp(): void
    {
        parent::setUp();
        Gate::define('viewApiDocs', fn ($user = null) => true);
    }

    public function test_opening_the_docs_builds_them(): void
    {
        $this->assertFileDoesNotExist($this->output.'/index.html');

        $this->get('/docs/api')->assertOk()->assertSee('nav-tree', false);

        $this->assertFileExists($this->output.'/index.html');
        $this->assertFileExists($this->output.'/'.SiteBuilder::FINGERPRINT_FILE);
    }

    public function test_an_unchanged_api_is_not_rebuilt(): void
    {
        $this->get('/docs/api')->assertOk();
        $built = filemtime($this->output.'/index.html');
        $this->expireThrottle();

        sleep(1); // mtime resolution
        $this->get('/docs/api')->assertOk();

        clearstatcache();
        $this->assertSame($built, filemtime($this->output.'/index.html'));
    }

    public function test_a_configuration_change_triggers_a_rebuild(): void
    {
        $this->get('/docs/api')->assertOk();
        $before = file_get_contents($this->output.'/index.html');
        $this->expireThrottle();

        config()->set('atlas.theme', 'ocean');
        $this->get('/docs/api/other/get-widgets/')->assertOk();

        $after = file_get_contents($this->output.'/index.html');
        preg_match('~app\.([0-9a-f]{8})\.css~', $before, $old);
        preg_match('~app\.([0-9a-f]{8})\.css~', $after, $new);
        $this->assertNotSame($old[1], $new[1], 'theme change should produce a new stylesheet');
    }

    public function test_it_is_off_outside_local_unless_enabled(): void
    {
        config()->set('atlas.auto_build', null);

        $this->assertFalse($this->app->make(SiteBuilder::class)->autoBuildEnabled());
    }

    /** Pretends the last check was long ago, past the burst throttle. */
    private function expireThrottle(): void
    {
        $file = $this->output.'/'.SiteBuilder::FINGERPRINT_FILE;
        $stamp = json_decode(file_get_contents($file), true);
        $stamp['checked'] = 0;
        file_put_contents($file, json_encode($stamp));
    }
}
