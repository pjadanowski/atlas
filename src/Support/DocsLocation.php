<?php

namespace Pjadanowski\Atlas\Support;

use Dedoc\Scramble\Http\Middleware\RestrictedDocsAccess;
use Dedoc\Scramble\Scramble;
use Illuminate\Contracts\Config\Repository as Config;
use Illuminate\Routing\Router;

/**
 * Answers the three questions both the build command and the serving route
 * need: where the generated site lives, which URI it is mounted at, and who is
 * allowed to see it.
 */
class DocsLocation
{
    /** Where Scramble's own routes file mounts the UI. */
    public const DEFAULT_PREFIX = 'docs/api';

    public function __construct(
        private readonly Config $config,
        private readonly Router $router,
    ) {}

    /** Root of this package — the generator ships inside it. */
    public function generatorPath(): string
    {
        return dirname(__DIR__, 2);
    }

    public function api(): string
    {
        return $this->config->get('atlas.api', 'default');
    }

    public function outputPath(): string
    {
        return rtrim((string) $this->config->get('atlas.output'), '/\\');
    }

    /**
     * URI prefix the documentation is mounted at, without surrounding slashes.
     *
     * Deliberately never returns null: the asset route is registered while
     * providers boot, and Scramble's own routes may not be loaded yet at that
     * point, so detection cannot be relied on here. Configuration wins, then
     * whatever can be detected, then Scramble's documented default.
     */
    public function routePrefix(): string
    {
        $configured = $this->config->get('atlas.route_prefix');
        if (is_string($configured) && $configured !== '') {
            return trim($configured, '/');
        }

        return $this->detectedRoutePrefix() ?? self::DEFAULT_PREFIX;
    }

    /**
     * The prefix Scramble actually mounted its UI at, or null while its routes
     * are not loaded (or when it is exposed through a closure). Only meaningful
     * once the application has fully booted — the build command uses it to
     * catch a `route_prefix` that no longer matches reality.
     */
    public function detectedRoutePrefix(): ?string
    {
        $named = $this->router->getRoutes()->getByName('scramble.docs.ui');
        if ($named !== null) {
            return trim($named->uri(), '/');
        }

        $exposed = Scramble::getGeneratorConfig($this->api())->uiRoute;

        return is_string($exposed) ? trim($exposed, '/') : null;
    }

    /** The generator's --base value ("/docs/api", or "" at the domain root). */
    public function base(): string
    {
        $prefix = $this->routePrefix();

        return $prefix === '' ? '' : '/'.$prefix;
    }

    /**
     * Middleware guarding the docs. Read straight from the config rather than
     * from Scramble's GeneratorConfig, which is only populated once Scramble
     * boots — this runs earlier than that.
     *
     * @return array<int, class-string|string>
     */
    public function middleware(): array
    {
        return (array) $this->config->get('scramble.middleware', [RestrictedDocsAccess::class]);
    }
}
