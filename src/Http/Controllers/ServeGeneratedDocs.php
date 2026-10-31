<?php

namespace Pjadanowski\Atlas\Http\Controllers;

use Pjadanowski\Atlas\Support\DocsLocation;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Serves the generated site from outside the document root, so the docs stay
 * behind whatever middleware Scramble is configured with.
 */
class ServeGeneratedDocs
{
    private const MIME_TYPES = [
        'html' => 'text/html; charset=utf-8',
        'css' => 'text/css; charset=utf-8',
        'js' => 'text/javascript; charset=utf-8',
        'json' => 'application/json; charset=utf-8',
        'md' => 'text/markdown; charset=utf-8',
        'txt' => 'text/plain; charset=utf-8',
        'svg' => 'image/svg+xml',
        'png' => 'image/png',
        'ico' => 'image/x-icon',
        'woff2' => 'font/woff2',
    ];

    public function __invoke(DocsLocation $location, string $path): BinaryFileResponse
    {
        $file = $this->resolve($location->outputPath(), $path);

        abort_if($file === null, 404);

        $extension = strtolower(pathinfo($file, PATHINFO_EXTENSION));

        return new BinaryFileResponse($file, headers: [
            'Content-Type' => self::MIME_TYPES[$extension] ?? 'application/octet-stream',
            // Bundles carry a content hash, so they can be cached forever;
            // "private" because the docs may sit behind authentication.
            'Cache-Control' => $this->isFingerprinted($file)
                ? 'private, max-age=31536000, immutable'
                : 'private, no-cache',
        ]);
    }

    private function resolve(string $root, string $path): ?string
    {
        $root = realpath($root);
        if ($root === false) {
            return null;
        }

        // realpath collapses any "../" before the comparison, so a traversal
        // attempt cannot survive the prefix check below.
        $target = realpath($root.DIRECTORY_SEPARATOR.$path);
        if ($target === false || ! str_starts_with($target, $root.DIRECTORY_SEPARATOR)) {
            return null;
        }

        if (is_dir($target)) {
            $target .= DIRECTORY_SEPARATOR.'index.html';
        }

        return is_file($target) ? $target : null;
    }

    private function isFingerprinted(string $file): bool
    {
        return (bool) preg_match('/\.[0-9a-f]{8}\.(css|js)$/', $file);
    }
}
