<?php

namespace Pjadanowski\Atlas\Mcp;

use Pjadanowski\Atlas\Support\DocsLocation;

/**
 * Docs MCP server — the PHP twin of build/mcp.mjs. Answers JSON-RPC messages
 * of the Model Context Protocol over the generated site: the search index,
 * the markdown twin of every page and the build manifest. Stateless, so it
 * fits the Streamable HTTP transport without sessions or SSE.
 */
class DocsMcp
{
    /** Index entries that are pages but not operations (see build/search.mjs). */
    private const NON_OPERATIONS = ['SCHEMA', 'TAG'];

    public const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

    private const SERVER_NAME = 'atlas-docs';

    private const SERVER_VERSION = '1.0.0';

    private ?SearchEngine $engine = null;

    /** @var array<int, array<string, mixed>>|null */
    private ?array $index = null;

    /** @var array<string, mixed>|null */
    private ?array $manifest = null;

    public function __construct(
        private readonly DocsLocation $location,
        private readonly string $siteUrl = '',
    ) {}

    /** True once `atlas:build` has produced the files this server reads. */
    public function isAvailable(): bool
    {
        return is_file($this->file('assets/search-index.json')) && is_file($this->file('assets/mcp-manifest.json'));
    }

    /**
     * @param  array<string, mixed>  $message
     * @return array<string, mixed>|null null for notifications
     */
    public function handle(array $message): ?array
    {
        if (($message['jsonrpc'] ?? null) !== '2.0' || ! is_string($message['method'] ?? null)) {
            return $this->error($message['id'] ?? null, -32600, 'Invalid request');
        }

        $id = $message['id'] ?? null;
        $isNotification = ! array_key_exists('id', $message);
        $method = $message['method'];
        $params = is_array($message['params'] ?? null) ? $message['params'] : [];

        try {
            $result = match (true) {
                $method === 'initialize' => $this->initialize($params),
                $method === 'ping' => [],
                $method === 'tools/list' => ['tools' => $this->tools()],
                $method === 'tools/call' => $this->callTool((string) ($params['name'] ?? ''), (array) ($params['arguments'] ?? [])),
                str_starts_with($method, 'notifications/') => null,
                default => throw new RpcException(-32601, "Method not found: {$method}"),
            };
        } catch (RpcException $exception) {
            return $isNotification ? null : $this->error($id, $exception->getCode(), $exception->getMessage());
        }

        if ($isNotification || $result === null) {
            return null;
        }

        return ['jsonrpc' => '2.0', 'id' => $id, 'result' => $result];
    }

    /** @return array<int, array<string, mixed>> */
    public function tools(): array
    {
        return [
            [
                'name' => 'search_api',
                'description' => 'Search the API documentation: endpoints and data models, by name, path, description, parameter names and operationId. Typo tolerant. Returns the best matches with links to their documentation.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'query' => ['type' => 'string', 'description' => 'Free text, e.g. "list bank accounts" or "kunden adresse"'],
                        'limit' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 25, 'default' => 10],
                    ],
                    'required' => ['query'],
                ],
            ],
            [
                'name' => 'list_endpoints',
                'description' => 'List every endpoint (method, path, title, operationId), grouped by tag. Optionally only one tag.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => ['tag' => ['type' => 'string', 'description' => 'Exact tag name to filter by']],
                ],
            ],
            [
                'name' => 'get_endpoint',
                'description' => 'Full documentation of one endpoint as markdown: parameters, request body, responses with examples. Identify it by operationId, or by method and path.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'operationId' => ['type' => 'string'],
                        'method' => ['type' => 'string', 'description' => 'GET, POST, …'],
                        'path' => ['type' => 'string', 'description' => 'Path as documented, e.g. /api/v1/kunden/{id}'],
                    ],
                ],
            ],
            [
                'name' => 'get_model',
                'description' => 'Documentation of one data model (schema): fields, types, required flags, example JSON.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => ['name' => ['type' => 'string', 'description' => 'Schema name, e.g. Kunde']],
                    'required' => ['name'],
                ],
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    public function callTool(string $name, array $arguments): array
    {
        $index = $this->index();

        switch ($name) {
            case 'search_api':
                $query = trim((string) ($arguments['query'] ?? ''));
                if ($query === '') {
                    throw new RpcException(-32602, 'query is required');
                }
                $limit = min(25, max(1, (int) ($arguments['limit'] ?? 10) ?: 10));
                $results = $this->engine()->search($query, $limit);
                if ($results === []) {
                    return $this->text("No results for \"{$query}\".");
                }
                $blocks = [];
                foreach ($results as ['entry' => $entry]) {
                    $lines = [
                        "{$entry['m']} ".($entry['p'] !== '' ? $entry['p'] : $entry['t'])." — {$entry['t']} [{$entry['g']}]",
                        "  id: {$entry['o']} · docs: {$this->absolute($entry['h'])}index.md",
                    ];
                    if ($entry['s'] !== '') {
                        $lines[] = "  {$entry['s']}";
                    }
                    $blocks[] = implode("\n", $lines);
                }

                return $this->text(implode("\n\n", $blocks));

            case 'list_endpoints':
                $tag = isset($arguments['tag']) ? (string) $arguments['tag'] : null;
                $groups = [];
                foreach ($index as $entry) {
                    if (in_array($entry['m'], self::NON_OPERATIONS, true) || ($tag !== null && $entry['g'] !== $tag)) {
                        continue;
                    }
                    $groups[$entry['g']][] = "{$entry['m']} {$entry['p']} — {$entry['t']} ({$entry['o']})";
                }
                if ($groups === []) {
                    $tags = implode(', ', $this->manifest()['tags'] ?? []);

                    return $this->text('No endpoints'.($tag !== null ? " tagged \"{$tag}\"" : '').". Tags: {$tags}");
                }
                $sections = [];
                foreach ($groups as $group => $lines) {
                    $sections[] = "## {$group}\n".implode("\n", $lines);
                }

                return $this->text(implode("\n\n", $sections));

            case 'get_endpoint':
                $id = isset($arguments['operationId']) ? mb_strtolower((string) $arguments['operationId']) : null;
                $method = isset($arguments['method']) ? strtoupper((string) $arguments['method']) : null;
                $path = isset($arguments['path']) ? rtrim((string) $arguments['path'], '/') : null;
                if ($id === null && ($method === null || $path === null)) {
                    throw new RpcException(-32602, 'Pass operationId, or method and path');
                }
                foreach ($index as $entry) {
                    if (in_array($entry['m'], self::NON_OPERATIONS, true)) {
                        continue;
                    }
                    $matches = $id !== null
                        ? mb_strtolower((string) $entry['o']) === $id
                        : $entry['m'] === $method && rtrim((string) $entry['p'], '/') === $path;
                    if ($matches) {
                        $body = $this->markdown($entry['h']) ?? "# {$entry['t']}\n\n{$entry['m']} {$entry['p']}";

                        return $this->text("{$body}\nPage: {$this->absolute($entry['h'])}\n");
                    }
                }
                $near = [];
                foreach ($this->engine()->search(trim(implode(' ', array_filter([$arguments['operationId'] ?? null, $method, $path]))), 5) as ['entry' => $entry]) {
                    $near[] = "{$entry['m']} {$entry['p']} ({$entry['o']})";
                }

                return $this->text('Endpoint not found.'.($near ? " Did you mean:\n".implode("\n", $near) : ''), true);

            case 'get_model':
                $wanted = mb_strtolower(trim((string) ($arguments['name'] ?? '')));
                if ($wanted === '') {
                    throw new RpcException(-32602, 'name is required');
                }
                foreach ($index as $entry) {
                    if ($entry['m'] === 'SCHEMA' && mb_strtolower((string) $entry['o']) === $wanted) {
                        $body = $this->markdown($entry['h']) ?? "# {$entry['t']}";

                        return $this->text("{$body}\nPage: {$this->absolute($entry['h'])}\n");
                    }
                }
                $near = [];
                foreach ($this->engine()->search((string) $arguments['name'], 25) as ['entry' => $entry]) {
                    if ($entry['m'] === 'SCHEMA' && count($near) < 5) {
                        $near[] = $entry['o'];
                    }
                }

                return $this->text('Model not found.'.($near ? ' Did you mean: '.implode(', ', $near) : ''), true);

            default:
                throw new RpcException(-32602, "Unknown tool: {$name}");
        }
    }

    /**
     * @param  array<string, mixed>  $params
     * @return array<string, mixed>
     */
    private function initialize(array $params): array
    {
        $manifest = $this->manifest();
        $requested = (string) ($params['protocolVersion'] ?? '');

        return [
            'protocolVersion' => in_array($requested, self::PROTOCOL_VERSIONS, true) ? $requested : self::PROTOCOL_VERSIONS[0],
            'capabilities' => ['tools' => ['listChanged' => false]],
            'serverInfo' => [
                'name' => self::SERVER_NAME,
                'title' => "{$manifest['title']} documentation",
                'version' => self::SERVER_VERSION,
            ],
            'instructions' => "Documentation for {$manifest['title']} v{$manifest['version']} (base URL {$manifest['baseUrl']}): "
                ."{$manifest['endpoints']} endpoints, {$manifest['models']} models. "
                .'Use search_api to find endpoints, get_endpoint for parameters and examples, get_model for data shapes. '
                ."The full OpenAPI document is at {$this->absolute($manifest['spec'])}.",
        ];
    }

    /** @return array<int, array<string, mixed>> */
    private function index(): array
    {
        if ($this->index === null) {
            $this->index = $this->json('assets/search-index.json');
        }

        return $this->index;
    }

    /** @return array<string, mixed> */
    private function manifest(): array
    {
        if ($this->manifest === null) {
            $this->manifest = $this->json('assets/mcp-manifest.json');
        }

        return $this->manifest;
    }

    private function engine(): SearchEngine
    {
        return $this->engine ??= new SearchEngine($this->index());
    }

    /** @return array<mixed> */
    private function json(string $relative): array
    {
        $raw = @file_get_contents($this->file($relative));
        if ($raw === false) {
            throw new RpcException(-32603, 'The documentation has not been built yet (run `php artisan atlas:build`).');
        }

        return (array) json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    }

    /** Markdown twin of a page; the href carries the route prefix. */
    private function markdown(string $href): ?string
    {
        $base = $this->location->base();
        if ($base !== '' && str_starts_with($href, $base)) {
            $href = substr($href, strlen($base));
        }
        $root = realpath($this->location->outputPath());
        $file = $root === false ? false : realpath($root.DIRECTORY_SEPARATOR.trim($href, '/').DIRECTORY_SEPARATOR.'index.md');
        if ($file === false || ! str_starts_with($file, $root.DIRECTORY_SEPARATOR)) {
            return null;
        }
        $content = @file_get_contents($file);

        return $content === false ? null : $content;
    }

    private function file(string $relative): string
    {
        return $this->location->outputPath().DIRECTORY_SEPARATOR.str_replace('/', DIRECTORY_SEPARATOR, $relative);
    }

    private function absolute(string $href): string
    {
        return $this->siteUrl.$href;
    }

    /** @return array<string, mixed> */
    private function text(string $text, bool $isError = false): array
    {
        $result = ['content' => [['type' => 'text', 'text' => $text]]];
        if ($isError) {
            $result['isError'] = true;
        }

        return $result;
    }

    /** @return array<string, mixed> */
    private function error(mixed $id, int $code, string $message): array
    {
        return ['jsonrpc' => '2.0', 'id' => $id, 'error' => ['code' => $code, 'message' => $message]];
    }
}
