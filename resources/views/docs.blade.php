@php
    /**
     * Scramble hands this view the freshly generated $spec, but Atlas is a
     * multi-page static site: the pages were rendered ahead of time by
     * `php artisan atlas:build`, and this view only serves the entry page.
     * Everything below the prefix is served by the package's asset route.
     */
    $location = app(\Pjadanowski\Atlas\Support\DocsLocation::class);
    $index = $location->outputPath().DIRECTORY_SEPARATOR.'index.html';
@endphp

@if (is_file($index))
{!! file_get_contents($index) !!}
@else
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Atlas — documentation not built yet</title>
    <style>
        :root { color-scheme: light dark; }
        body { margin: 0; min-height: 100vh; display: grid; place-items: center;
               font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; }
        main { max-width: 34rem; padding: 2rem; }
        h1 { font-size: 1.25rem; margin: 0 0 .75rem; }
        p { margin: 0 0 1rem; opacity: .8; }
        code, pre { font-family: ui-monospace, SFMono-Regular, monospace; font-size: .85em; }
        pre { padding: .85rem 1rem; border-radius: .5rem; overflow-x: auto;
              background: color-mix(in srgb, currentColor 8%, transparent); }
    </style>
</head>
<body>
<main>
    <h1>The documentation has not been generated yet</h1>
    <p>Atlas renders a static site ahead of time. Build it, then reload this page:</p>
    <pre><code>php artisan atlas:build</code></pre>
    <p>
        The output goes to <code>{{ $location->outputPath() }}</code>, configurable in
        <code>config/atlas.php</code>. Run the command as part of deployment so the
        published docs follow the code.
    </p>
</main>
</body>
</html>
@endif
