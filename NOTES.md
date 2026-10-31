# Notes

Dziennik decyzji — dlaczego coś jest zrobione tak, a nie inaczej. Nowe wpisy na
górze. Reguły projektu żyją w `AGENTS.md` i `docs/`, tu trafia kontekst, którego
z samego kodu nie da się odczytać.

---

## 2026-09-14 — `--allow-spec-html` działa per opis, build ma go włączony

**Problem.** Na górze strony głównej renderował się widoczny tag soup:
`<section class="info">`, `<div>`, `</p>`. Źródłem jest `info.description`
w `openapi.json` — jest tam napisany jako prawdziwy HTML (nagłówek, dwa
akapity, callout „Wichtiger Hinweis", link mailto). Domyślnie generator
przepuszcza opisy przez wąską allowlistę markdowna w `build/text.mjs`
i wszystko poza nią escape'uje, więc te tagi wychodziły jako tekst.

**Dlaczego nie wystarczyło włączyć flagi.** `--allow-spec-html` istniał już
wcześniej, ale przełączał *cały* build na tryb verbatim. Ta specyfikacja ma
jednak 57 opisów pisanych markdownem — `**gelöscht (Soft-Delete)**`,
`### …`, legendy enumów rozdzielone pustymi liniami („Aufgabengebiet ids:
1 - Service…"). Globalny przełącznik wypisałby ich `**` i `###`
dosłownie. Sprawdzone: 0 opisów w tej specyfikacji miesza HTML z markdownem,
więc podział jest czysty i da się rozstrzygać automatycznie.

**Rozwiązanie.** Przełącznik decyduje teraz per opis:

- `build/text.mjs` — `isAuthoredHtml()` zwraca `true`, gdy opis zawiera tag
  spoza inline'owej allowlisty (`a|br|strong|b|i|em|code|span`), czyli
  `<section>`, `<div>`, `<p>`, `<h2>`, `<ul>`, `<table>` itd. `verbatim()`
  łączy to z flagą, a `mdInline`, `mdBlock` i `descriptionHtml` bramkują się
  na `verbatim(value)` zamiast na gołym `allowSpecHtml`.
- `package.json` — `npm run build` i `npm run watch` przekazują
  `--allow-spec-html`.

**To nie jest sanitizer.** Zaufanie nadal daje wyłącznie flaga; `isAuthoredHtml`
wybiera tylko renderer. Reguła z `docs/04-development-rules.md` — „nie dodawać
sanitizera, poprzedni został usunięty jako obchodzalny" — zostaje w mocy.
Jeśli kiedyś ta specyfikacja przestanie pochodzić z własnego kodu, wyłącz
flagę; nic poniżej niej nie chroni.

**Weryfikacja.** 350 stron, zero pozostałości `&lt;section` / `&lt;div`
w całym `dist/`; opisy markdownowe nadal renderują `<strong>` i
`<h3 class="md-heading">`. `vendor/bin/phpunit` → 10/10.

**Test.** `tests/MarkdownDescriptionTest.php` pilnuje, że przy włączonej fladze
opisy markdownowe nadal idą przez markdown. Musi być osobną klasą, bo Scramble
robi snapshot `scramble.info.description` przy boocie — fixture HTML-owy
i markdownowy nie zmieszczą się w jednej klasie testowej.

**Otwarte.** Klasy `info-*` nie mają nigdzie CSS-a, więc sekcja dostaje samą
bazową typografię z `.spec-html` (`assets/css/40-content.css`) — callout
„Wichtiger Hinweis" jest bez ramki i tła. Do decyzji, czy dopisać dla nich
style. Lepsze miejsce niż `40-content.css`: własny plik podpięty przez `--css`
(patrz ściągawka niżej) — `info-*` to klasy tej konkretnej specyfikacji,
a nie generatora, więc nie powinny wsiąkać w jego bundle.

---

## Ściągawka: wstrzykiwanie własnego CSS-a i JS-a

Da się, bez dotykania bundli generatora. `--css` i `--js` są powtarzalne, każdy
zestaw jest sklejany, minifikowany (CSS), hashowany i zapisywany jako
`dist/assets/custom.<hash>.css|js`:

```bash
node build/index.mjs --css brand.css --css overrides.css --js analytics.js
```

Kolejność ładowania jest tym, co daje im moc nadpisywania — sprawdzone
w wygenerowanym HTML-u:

- CSS: `<link>` w `<head>` **po** `app.<hash>.css`
- JS: `<script defer>` na końcu `<body>` **po** `app.<hash>.js`

Restyling sprowadza się zwykle do przedefiniowania tokenów z
`assets/css/00-tokens.css`:

```css
:root { --accent: #e0245e; --font-ui: 'Inter', system-ui, sans-serif; }
```

Po stronie Laravela te same rzeczy konfiguruje się w `config/atlas.php`
(`css`, `js`, `allow_spec_html`) zamiast na linii poleceń, żeby każdy build
był zgodny:

```php
'allow_spec_html' => true,
'css' => [resource_path('atlas/theme.css')],
'js'  => [resource_path('atlas/extra.js')],
```

Pliki custom celowo nie wchodzą do głównych bundli: ich hashe zostają stabilne,
a zepsuty plik operatora widać od razu w network panelu.
