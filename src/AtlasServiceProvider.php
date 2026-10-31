<?php

namespace Pjadanowski\Atlas;

use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Route;
use Pjadanowski\Atlas\Commands\BuildDocsCommand;
use Pjadanowski\Atlas\Http\Controllers\McpEndpoint;
use Pjadanowski\Atlas\Http\Controllers\ServeGeneratedDocs;
use Pjadanowski\Atlas\Support\DocsLocation;
use Spatie\LaravelPackageTools\Package;
use Spatie\LaravelPackageTools\PackageServiceProvider;

class AtlasServiceProvider extends PackageServiceProvider
{
    public function configurePackage(Package $package): void
    {
        $package
            ->name('atlas')
            ->hasConfigFile()
            ->hasViews('atlas')
            ->hasCommand(BuildDocsCommand::class);
    }

    /**
     * Registers Atlas as a Scramble renderer. This runs first thing in
     * register(), which is load-bearing: Scramble snapshots its config in
     * bootingPackage(), so anything set later would never be seen.
     */
    public function registeringPackage(): void
    {
        Config::set('scramble.renderers.atlas', array_merge(
            ['view' => 'atlas::docs'],
            (array) Config::get('scramble.renderers.atlas', []),
        ));
    }

    public function packageBooted(): void
    {
        $location = $this->app->make(DocsLocation::class);

        // The docs double as an MCP server for editor assistants. Registered
        // before the catch-all so "mcp" is never looked up as a file, and with
        // the docs' own middleware so it is exactly as visible as the docs.
        Route::match(['GET', 'POST', 'OPTIONS', 'DELETE'], $location->routePrefix().'/mcp', McpEndpoint::class)
            ->middleware($location->middleware())
            ->name('atlas.docs.mcp');

        // Scramble's own route answers the bare prefix and hands back the
        // generated index.html; this one serves everything below it. The
        // required {path} segment keeps the two from overlapping, so the order
        // the two providers boot in does not matter.
        Route::get($location->routePrefix().'/{path}', ServeGeneratedDocs::class)
            ->where('path', '.+')
            ->middleware($location->middleware())
            ->name('atlas.docs.asset');
    }
}
