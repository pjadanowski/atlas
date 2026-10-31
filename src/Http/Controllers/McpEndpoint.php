<?php

namespace Pjadanowski\Atlas\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Pjadanowski\Atlas\Mcp\DocsMcp;
use Pjadanowski\Atlas\Support\DocsLocation;

/**
 * <docs>/mcp — Model Context Protocol over Streamable HTTP, stateless variant:
 * every POST carries a JSON-RPC message (or a batch) and receives a plain
 * JSON answer. No sessions, no server-initiated stream, so GET is 405 as the
 * transport specification prescribes for servers without one.
 *
 * Registered behind the same middleware as the documentation itself, so the
 * MCP surface inherits the docs' visibility.
 */
class McpEndpoint
{
    private const CORS = [
        'Access-Control-Allow-Origin' => '*',
        'Access-Control-Allow-Methods' => 'POST, OPTIONS',
        'Access-Control-Allow-Headers' => 'Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
    ];

    public function __invoke(Request $request, DocsLocation $location): Response
    {
        if ($request->isMethod('OPTIONS')) {
            return response('', 204, self::CORS);
        }
        if (! $request->isMethod('POST')) {
            return response('MCP endpoint: POST JSON-RPC messages here.', 405, self::CORS + [
                'Allow' => 'POST, OPTIONS',
                'Content-Type' => 'text/plain; charset=utf-8',
            ]);
        }

        $server = new DocsMcp($location, $request->getSchemeAndHttpHost());

        $parsed = json_decode((string) $request->getContent(), true);
        if (! is_array($parsed)) {
            return $this->json(400, [
                'jsonrpc' => '2.0', 'id' => null, 'error' => ['code' => -32700, 'message' => 'Parse error'],
            ]);
        }

        $isBatch = array_is_list($parsed);
        $answers = [];
        foreach ($isBatch ? $parsed : [$parsed] as $message) {
            $answer = $server->handle(is_array($message) ? $message : []);
            if ($answer !== null) {
                $answers[] = $answer;
            }
        }

        if ($answers === []) {
            return response('', 202, self::CORS);
        }

        return $this->json(200, $isBatch ? $answers : $answers[0]);
    }

    /** @param  array<mixed>  $payload */
    private function json(int $status, array $payload): Response
    {
        return response(
            json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            $status,
            self::CORS + ['Content-Type' => 'application/json; charset=utf-8'],
        );
    }
}
