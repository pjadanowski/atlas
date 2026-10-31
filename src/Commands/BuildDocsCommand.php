<?php

namespace Pjadanowski\Atlas\Commands;

use Dedoc\Scramble\CacheableGenerator;
use Dedoc\Scramble\Scramble;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Process;
use Pjadanowski\Atlas\Support\DocsLocation;

class BuildDocsCommand extends Command
{
    protected $signature = 'atlas:build
                            {--spec= : Build from an existing OpenAPI file instead of generating one}
                            {--out= : Override the output directory}
                            {--base= : Override the sub-path the docs are served from}
                            {--lang= : Override the page language attribute}
                            {--allow-spec-html : Render specification descriptions as HTML instead of escaping them}';

    protected $description = 'Generate the Atlas documentation site from the Scramble specification';

    public function handle(DocsLocation $location, CacheableGenerator $generator): int
    {
        $this->warnAboutConfiguration($location);

        $specPath = $this->option('spec');
        $temporarySpec = null;

        if ($specPath === null) {
            $this->components->task('Generating OpenAPI specification', function () use ($generator, $location, &$temporarySpec) {
                $document = $generator(Scramble::getGeneratorConfig($location->api()));
                $temporarySpec = tempnam(sys_get_temp_dir(), 'atlas-');
                file_put_contents($temporarySpec, json_encode(
                    $document,
                    JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
                ));
            });
            $specPath = $temporarySpec;
        }

        $result = Process::path($location->generatorPath())
            ->timeout((int) Config::get('atlas.timeout', 300))
            ->run($this->generatorCommand($location, $specPath));

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

        $this->line(trim($result->output()));

        return self::SUCCESS;
    }

    /** @return array<int, string> */
    private function generatorCommand(DocsLocation $location, string $specPath): array
    {
        $base = $this->option('base') ?? $location->base();

        $command = [
            (string) Config::get('atlas.node', 'node'),
            'build/index.mjs',
            '--spec', $specPath,
            '--out', $this->option('out') ?: $location->outputPath(),
            '--lang', $this->option('lang') ?: (string) Config::get('atlas.lang', 'en'),
        ];

        if ($base !== '') {
            $command[] = '--base';
            $command[] = $base;
        }

        if ($this->option('allow-spec-html') || Config::get('atlas.allow_spec_html', false)) {
            $command[] = '--allow-spec-html';
        }

        foreach (['css', 'js'] as $kind) {
            foreach ((array) Config::get("atlas.{$kind}", []) as $file) {
                $command[] = "--{$kind}";
                $command[] = $file;
            }
        }

        return $command;
    }

    /**
     * Two ways to end up with a working build nobody ever sees, both of them
     * silent at runtime — worth naming explicitly.
     */
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
