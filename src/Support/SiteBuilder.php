<?php

namespace Pjadanowski\Atlas\Support;

use Dedoc\Scramble\CacheableGenerator;
use Dedoc\Scramble\Scramble;
use Illuminate\Contracts\Process\ProcessResult;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Process;

/**
 * Generates the static site: asks Scramble for the specification and runs
 * the Node generator over it. Shared by `atlas:build` and the development
 * auto-build, so both produce exactly the same output.
 */
class SiteBuilder
{
    /** Written next to the site; identifies what it was built from. */
    public const FINGERPRINT_FILE = '.atlas-build';

    /** Auto-build checks at most this often (seconds) — page clicks come in bursts. */
    private const CHECK_INTERVAL = 2;

    public function __construct(
        private readonly DocsLocation $location,
        private readonly CacheableGenerator $generator,
    ) {}

    /** The OpenAPI document Scramble generates for the configured API, as JSON. */
    public function specification(): string
    {
        $document = ($this->generator)(Scramble::getGeneratorConfig($this->location->api()));

        return json_encode($document, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    /**
     * @param  array{out?: ?string, base?: ?string, lang?: ?string, allow_spec_html?: bool}  $options
     */
    public function build(string $specPath, array $options = []): ProcessResult
    {
        return Process::path($this->location->generatorPath())
            ->timeout((int) Config::get('atlas.timeout', 300))
            ->run($this->command($specPath, $options));
    }

    /**
     * Rebuilds the site when the specification or the Atlas configuration
     * changed since the last build — the development loop of `auto_build`.
     * Never throws: a failed rebuild leaves the previous site in place and
     * is reported to the log, so the docs page itself keeps working.
     */
    public function ensureFresh(): void
    {
        if (! $this->autoBuildEnabled()) {
            return;
        }

        $output = $this->location->outputPath();
        $stampFile = $output.DIRECTORY_SEPARATOR.self::FINGERPRINT_FILE;
        $stamp = is_file($stampFile) ? (json_decode((string) file_get_contents($stampFile), true) ?: []) : [];
        if (isset($stamp['checked']) && time() - (int) $stamp['checked'] < self::CHECK_INTERVAL && is_file($output.'/index.html')) {
            return;
        }

        try {
            $specification = $this->specification();
            $fingerprint = $this->fingerprint($specification);

            if (($stamp['fingerprint'] ?? null) !== $fingerprint || ! is_file($output.'/index.html')) {
                $specPath = tempnam(sys_get_temp_dir(), 'atlas-');
                file_put_contents($specPath, $specification);
                try {
                    $result = $this->build($specPath);
                } finally {
                    @unlink($specPath);
                }
                if (! $result->successful()) {
                    logger()->warning('Atlas auto-build failed: '.trim($result->errorOutput() ?: $result->output()));

                    return;
                }
            }

            $this->writeStamp($fingerprint);
        } catch (\Throwable $exception) {
            logger()->warning('Atlas auto-build failed: '.$exception->getMessage());
        }
    }

    /** Records what the current site was built from (also called by atlas:build). */
    public function writeStamp(string $fingerprint): void
    {
        $output = $this->location->outputPath();
        if (! is_dir($output)) {
            return;
        }
        file_put_contents(
            $output.DIRECTORY_SEPARATOR.self::FINGERPRINT_FILE,
            json_encode(['fingerprint' => $fingerprint, 'checked' => time()]),
        );
    }

    /**
     * Specification + every option that shapes the output + the generator's
     * own version, so upgrading Atlas or changing its config rebuilds too.
     */
    public function fingerprint(string $specification): string
    {
        return hash('sha256', implode("\0", [
            $specification,
            json_encode(Config::get('atlas')),
            $this->location->base(),
            $this->generatorVersion(),
            $this->wsdlVersion(),
        ]));
    }

    /**
     * Local WSDL files and the schemas beside them (imports usually sit in
     * the same directory): their modification times, so editing an XSD
     * rebuilds too. Remote WSDLs are fetched at build time and not tracked.
     */
    private function wsdlVersion(): string
    {
        $stamps = [];
        foreach ((array) Config::get('atlas.wsdl', []) as $wsdl) {
            if (preg_match('~^https?://~i', (string) $wsdl) || ! is_file($wsdl)) {
                continue;
            }
            foreach (glob(dirname($wsdl).'/*.{wsdl,xsd}', GLOB_BRACE) ?: [] as $file) {
                $stamps[] = $file.':'.filemtime($file);
            }
        }

        return implode('|', $stamps);
    }

    public function autoBuildEnabled(): bool
    {
        $configured = Config::get('atlas.auto_build');

        return $configured === null ? app()->isLocal() : (bool) $configured;
    }

    private function generatorVersion(): string
    {
        $root = $this->location->generatorPath();
        $latest = 0;
        foreach (['build', 'assets'] as $directory) {
            $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root.'/'.$directory, \FilesystemIterator::SKIP_DOTS));
            foreach ($files as $file) {
                $latest = max($latest, $file->getMTime());
            }
        }

        return (string) $latest;
    }

    /**
     * @param  array{out?: ?string, base?: ?string, lang?: ?string, allow_spec_html?: bool}  $options
     * @return list<string>
     */
    private function command(string $specPath, array $options): array
    {
        $base = $options['base'] ?? $this->location->base();

        $command = [
            (string) Config::get('atlas.node', 'node'),
            'build/index.mjs',
            '--spec', $specPath,
            '--out', ($options['out'] ?? null) ?: $this->location->outputPath(),
            '--lang', ($options['lang'] ?? null) ?: (string) Config::get('atlas.lang', 'en'),
        ];

        if ($base !== '') {
            $command[] = '--base';
            $command[] = $base;
        }

        if (($options['allow_spec_html'] ?? false) || Config::get('atlas.allow_spec_html', false)) {
            $command[] = '--allow-spec-html';
        }

        foreach (['theme', 'logo', 'favicon'] as $option) {
            $value = (string) Config::get("atlas.{$option}", '');
            if ($value !== '') {
                $command[] = "--{$option}";
                $command[] = $value;
            }
        }

        foreach ((array) Config::get('atlas.wsdl', []) as $wsdl) {
            $command[] = '--wsdl';
            $command[] = $wsdl;
        }

        foreach (['soap_security' => '--soap-security', 'soap_sts' => '--soap-sts'] as $key => $flag) {
            $value = (string) Config::get("atlas.{$key}", '');
            if ($value !== '') {
                $command[] = $flag;
                $command[] = $value;
            }
        }

        foreach (['css', 'js'] as $kind) {
            foreach ((array) Config::get("atlas.{$kind}", []) as $file) {
                $command[] = "--{$kind}";
                $command[] = $file;
            }
        }

        return $command;
    }
}
