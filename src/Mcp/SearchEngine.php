<?php

namespace Pjadanowski\Atlas\Mcp;

/**
 * PHP twin of assets/search/10-engine.js — the same typo-tolerant ranking
 * over the same build-time index, so the MCP endpoint served by Laravel finds
 * exactly what the ⌘K palette finds. Keep the two in step: field weights,
 * typo budget, prefix and phrase scoring are mirrored line for line.
 */
class SearchEngine
{
    /** @var array<string, int> field key => weight */
    private const FIELDS = ['t' => 10, 'p' => 8, 'k' => 6, 'g' => 4, 'd' => 2];

    private const DIACRITICS = [
        'ä' => 'a', 'ö' => 'o', 'ü' => 'u', 'ß' => 'ss', 'à' => 'a', 'á' => 'a', 'â' => 'a', 'ã' => 'a',
        'å' => 'a', 'æ' => 'ae', 'ç' => 'c', 'è' => 'e', 'é' => 'e', 'ê' => 'e', 'ë' => 'e', 'ì' => 'i',
        'í' => 'i', 'î' => 'i', 'ï' => 'i', 'ñ' => 'n', 'ò' => 'o', 'ó' => 'o', 'ô' => 'o', 'õ' => 'o',
        'ø' => 'o', 'ù' => 'u', 'ú' => 'u', 'û' => 'u', 'ý' => 'y', 'ÿ' => 'y', 'ą' => 'a', 'ć' => 'c',
        'ę' => 'e', 'ł' => 'l', 'ń' => 'n', 'ś' => 's', 'ź' => 'z', 'ż' => 'z', 'œ' => 'oe',
    ];

    /** @var array<int, array{entry: array<string, mixed>, fields: array<string, array<int, string>>, path: string}> */
    private array $prepared = [];

    /** @param array<int, array<string, mixed>> $index decoded search-index.json */
    public function __construct(array $index)
    {
        foreach ($index as $entry) {
            $fields = [];
            foreach (self::FIELDS as $key => $weight) {
                $fields[$key] = array_values(array_unique(self::tokenize((string) ($entry[$key] ?? ''))));
            }
            $this->prepared[] = [
                'entry' => $entry,
                'fields' => $fields,
                'path' => self::fold((string) ($entry['p'] ?? '')),
            ];
        }
    }

    /**
     * @return array<int, array{entry: array<string, mixed>, score: float}>
     */
    public function search(string $query, int $limit): array
    {
        return $this->rank(array_values(array_unique(self::tokenize($query))), $limit);
    }

    /**
     * @param  array<int, string>  $terms
     * @return array<int, array{entry: array<string, mixed>, score: float}>
     */
    private function rank(array $terms, int $limit): array
    {
        if ($terms === []) {
            return [];
        }

        $scored = [];
        foreach ($this->prepared as $item) {
            $score = 0.0;
            $keys = [];
            foreach ($terms as $term) {
                $best = 0.0;
                $bestKey = null;
                foreach ($item['fields'] as $key => $tokens) {
                    foreach ($tokens as $token) {
                        $quality = self::termQuality($term, $token);
                        if ($quality === 0.0) {
                            continue;
                        }
                        $value = $quality * self::FIELDS[$key];
                        if ($value > $best) {
                            $best = $value;
                            $bestKey = $key;
                        }
                    }
                }
                if (strlen($term) >= 2 && $item['path'] !== '' && str_contains($item['path'], $term)) {
                    $value = 0.95 * 8;
                    if ($value > $best) {
                        $best = $value;
                        $bestKey = 'p';
                    }
                }
                if ($best === 0.0) {
                    continue 2;
                }
                $score += $best;
                $keys[$bestKey] = true;
            }
            if (count($terms) > 1 && count($keys) === 1) {
                $score += 0.5 * self::FIELDS[array_key_first($keys)];
            }
            $first = $item['fields']['t'][0] ?? null;
            if ($first !== null && str_starts_with($first, $terms[0])) {
                $score += 3;
            }
            $scored[] = ['entry' => $item['entry'], 'score' => $score];
        }

        // Nothing matched every word: drop the last one and try again (Typesense's drop_tokens_threshold).
        if ($scored === [] && count($terms) > 1) {
            return $this->rank(array_slice($terms, 0, -1), $limit);
        }

        usort($scored, fn (array $a, array $b) => $b['score'] <=> $a['score']
            ?: strlen((string) $a['entry']['t']) <=> strlen((string) $b['entry']['t']));

        return array_slice($scored, 0, $limit);
    }

    public static function fold(string $value): string
    {
        if (class_exists(\Normalizer::class)) {
            $value = \Normalizer::normalize($value, \Normalizer::FORM_D) ?: $value;
            $value = preg_replace('/\p{Mn}+/u', '', $value) ?? $value;
        }
        $value = mb_strtolower($value, 'UTF-8');

        return strtr($value, self::DIACRITICS);
    }

    /** @return array<int, string> */
    public static function tokenize(string $value): array
    {
        $split = preg_replace('/([a-z\d])([A-Z])/', '$1 $2', $value) ?? $value;
        $parts = preg_split('/[^a-z0-9]+/', self::fold($split)) ?: [];

        return array_values(array_filter($parts, fn (string $part) => $part !== ''));
    }

    public static function allowedTypos(string $term): int
    {
        $length = strlen($term);

        return $length >= 8 ? 2 : ($length >= 4 ? 1 : 0);
    }

    /** Optimal string alignment distance (Damerau-Levenshtein), capped at $max + 1. */
    public static function distance(string $a, string $b, int $max): int
    {
        $la = strlen($a);
        $lb = strlen($b);
        if (abs($la - $lb) > $max) {
            return $max + 1;
        }
        $previous2 = null;
        $previous = range(0, $lb);
        for ($i = 1; $i <= $la; $i++) {
            $current = [$i];
            $rowMin = $i;
            for ($j = 1; $j <= $lb; $j++) {
                $cost = $a[$i - 1] === $b[$j - 1] ? 0 : 1;
                $value = min($previous[$j] + 1, $current[$j - 1] + 1, $previous[$j - 1] + $cost);
                if ($previous2 !== null && $i > 1 && $j > 1 && $a[$i - 1] === $b[$j - 2] && $a[$i - 2] === $b[$j - 1]) {
                    $value = min($value, $previous2[$j - 2] + 1);
                }
                $current[] = $value;
                $rowMin = min($rowMin, $value);
            }
            if ($rowMin > $max) {
                return $max + 1;
            }
            $previous2 = $previous;
            $previous = $current;
        }

        return $previous[$lb];
    }

    public static function termQuality(string $term, string $token): float
    {
        if ($token === $term) {
            return 1.0;
        }
        if (str_starts_with($token, $term)) {
            return strlen($term) >= 2 ? 0.5 + (0.4 * strlen($term)) / strlen($token) : 0.3;
        }
        $typos = self::allowedTypos($term);
        if ($typos === 0) {
            return 0.0;
        }
        $whole = self::distance($term, $token, $typos);
        if ($whole <= $typos) {
            return 0.7 - 0.2 * ($whole - 1);
        }
        if (strlen($token) > strlen($term)) {
            $head = self::distance($term, substr($token, 0, strlen($term)), $typos);
            if ($head <= $typos) {
                return 0.5 - 0.2 * ($head - 1);
            }
        }

        return 0.0;
    }
}
