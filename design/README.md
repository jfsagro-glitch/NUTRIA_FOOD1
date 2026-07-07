# Логотип NUTRIA

`nutria-logo-source.svg` — исходник с закруглённым фоном (rx=96), используется для
файлов, где нужна собственная подложка со скруглёнными углами (не для favicon/PWA).

`nutria-logo-square.svg` — тот же дизайн без скругления и без прозрачности (полный
непрозрачный квадрат) — источник для favicon, apple-touch-icon и maskable-иконок
PWA (`icon-192.png`, `icon-512.png`): эти форматы сами накладывают свою маску
(круг/squircle/квадрат с закруглением по ОС), поэтому в файле не должно быть ни
собственного скругления, ни прозрачных углов.

`nutria-mark-transparent.svg` — тот же дизайн без фоновой плашки вообще (прозрачный
фон) — источник для `public/logo.png`, который в приложении показывается поверх уже
цветного/тёмного контейнера.

Перегенерировать все файлы после правки любого из трёх SVG:

```bash
python3 -c "
import cairosvg
cairosvg.svg2png(url='design/nutria-mark-transparent.svg', write_to='public/logo.png', output_width=1024, output_height=1024)
cairosvg.svg2png(url='design/nutria-logo-square.svg', write_to='public/icons/icon-512.png', output_width=512, output_height=512)
cairosvg.svg2png(url='design/nutria-logo-square.svg', write_to='public/icons/icon-192.png', output_width=192, output_height=192)
cairosvg.svg2png(url='design/nutria-logo-square.svg', write_to='public/icons/apple-touch-icon.png', output_width=180, output_height=180)
cairosvg.svg2png(url='design/nutria-logo-square.svg', write_to='public/icons/favicon-32x32.png', output_width=32, output_height=32)
cairosvg.svg2png(url='design/nutria-logo-square.svg', write_to='public/icons/favicon-16x16.png', output_width=16, output_height=16)
"
```

Требует `pip install cairosvg`.
