<?php

namespace Pjadanowski\Atlas\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Config;
use Pjadanowski\Atlas\Support\DocsLocation;
use Pjadanowski\Atlas\Support\SiteBuilder;

class BuildDocsCommand extends Command
{
    protected $signature = 'atlas:build
                            {--spec= : Build from an existing OpenAPI file instead of generating one}
                            {--out= : Override the output directory}
                            {--base= : Override the sub-path the docs are served from}
                            {--lang= : Override the page language attribute}
                            {--allow-spec-html : Render specification descriptions as HTML instead of escaping them}';

    protected $description = 'Generate the Atlas documentation site from the Scramble specification';

    public function handle(DocsLocation $location, SiteBuilder $builder): int
    {
        $this->warnAboutConfiguration($location);

        $specPath = $this->option('spec');
        $specification = null;
        $temporarySpec = null;

        if ($specPath === null) {
            $this->components->task('Generating OpenAPI specification', function () use ($builder, &$specification, &$temporarySpec) {
                $specification = $builder->specification();
                $temporarySpec = tempnam(sys_get_temp_dir(), 'atlas-');
                file_put_contents($temporarySpec, $specification);
            });
            $specPath = $temporarySpec;
        }

        $result = $builder->build($specPath, [
            'out' => $this->option('out'),
            'base' => $this->option('base'),
            'lang' => $this->option('lang'),
            'allow_spec_html' => (bool) $this->option('allow-spec-html'),
        ]);

        if ($temporarySpec !== null) {
            @unlink($temporarySpec);
        }

        if (! $result->successful()) {
            $this->components->error('The generator failed.');
            $this->line(trim($result->errorOutput() ?: $result->output()));
            $this->line('');
            $this->components->info('Node is required to build the docs. Set `atlas.node` if it is not on the PATH.');

            return self::FAILURE;
        }

        // A default build is exactly what auto-build would produce: record it,
        // so the first docs request after a deploy-time build does not redo it.
        $isDefaultBuild = $specification !== null && ! $this->option('out') && ! $this->option('base')
            && ! $this->option('lang') && ! $this->option('allow-spec-html');
        if ($isDefaultBuild) {
            $builder->writeStamp($builder->fingerprint($specification));
        }

        $this->line(trim($result->output()));

        return self::SUCCESS;
    }

    private function warnAboutConfiguration(DocsLocation $location): void
    {
        if (Config::has('scramble.ui.logo')) {
            $this->components->warn(
                'config/scramble.php still defines `ui.logo`. Scramble treats that as its legacy '
                .'configuration and forces the `elements` renderer, ignoring `renderer`. Remove the key.'
            );
        }

        if (Config::get('scramble.renderer') !== 'atlas') {
            $this->components->warn(
                "Scramble's `renderer` is set to `".Config::get('scramble.renderer', 'elements')
                .'`. The site will be built, but Scramble will keep rendering the other UI. '
                ."Set 'renderer' => 'atlas' in config/scramble.php."
            );
        }

        $detected = $location->detectedRoutePrefix();
        if ($detected !== null && $detected !== $location->routePrefix()) {
            $this->components->warn(
                "Scramble serves its documentation from `{$detected}`, but Atlas is building for "
                ."`{$location->routePrefix()}`. Set 'route_prefix' => '{$detected}' in config/atlas.php, "
                .'otherwise every link and asset URL will point at the wrong path.'
            );
        }
    }
}
