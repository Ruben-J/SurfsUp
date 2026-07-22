# SurfsUp — projecthandleiding voor agents

Lees dit bestand voordat je aan de code werkt. Het beschrijft de huidige architectuur, bewuste ontwerpkeuzes en valkuilen van de SurfsUp-site.

## Doel van het project

SurfsUp is een statisch, mobielvriendelijk surf-dashboard voor de Maasvlakte:

- live: <https://ruben-j.github.io/SurfsUp/>;
- repository: `Ruben-J/SurfsUp`;
- geen framework, backend, database of API-sleutels;
- GitHub Actions haalt data op en publiceert GitHub Pages;
- de site kan via een iframe in WordPress worden geplaatst.

De surfscore is een praktische indicatie, nooit veiligheidsadvies. Houd de disclaimer zichtbaar en wek niet de indruk dat de score stroming, lokale gevaren of het niveau van de surfer vervangt.

## Snel beginnen

Vereist: Node.js 20 of nieuwer.

```bash
npm run check
npm run serve
```

Open daarna `http://localhost:4173`.

Alleen wanneer verse data nodig is:

```bash
npm run data       # data/latest.json
npm run history    # data/history.json, ongeveer 31 dagen
npm run archive    # data/archive.json, één volgend jaar per boei
```

De data-opdrachten gebruiken externe API's en wijzigen bestanden onder `data/`. Voer ze niet onnodig uit tijdens een kleine UI-wijziging.

## Belangrijkste bestanden

| Bestand | Verantwoordelijkheid |
| --- | --- |
| `index.html` | Semantische paginastructuur, navigatie, laadstatussen en disclaimer. |
| `styles.css` | Alle vormgeving en responsive gedrag. Belangrijkste mobiele breakpoint: `760px`. |
| `app.js` | Data laden, vijfdaagse kaarten, boeikaarten, grafieken, getij/weer/maan en interacties. |
| `scoring.js` | Pure surfscore-, label- en Beaufortfuncties. |
| `scripts/check-score.mjs` | Grensgevallen voor score en Beaufort. Wordt door `npm run check` uitgevoerd. |
| `scripts/fetch-data.mjs` | Actuele boeidata, 72-uursforecast, kustweer, getij, temperatuur en maan. |
| `scripts/fetch-history.mjs` | Ongeveer 31 dagen uurhistorie voor drie boeien plus windhistorie. |
| `scripts/backfill-history.mjs` | Hervatbaar langetermijnarchief met maandstatistieken van significante golfhoogte. |
| `data/latest.json` | Actuele situatie en forecast; tijdens iedere Pages-build opnieuw gegenereerd. |
| `data/history.json` | Uurhistorie voor de 24-uurs-, 7-daagse en 30-daagse grafiek. |
| `data/archive.json` | Groeiend maandarchief; momenteel niet in de interface getoond. |
| `.github/workflows/pages.yml` | Uurlijkse data-update en GitHub Pages-deployment. |
| `.github/workflows/history.yml` | Nachtelijke vernieuwing van de 31-daagse historie. |
| `.github/workflows/archive.yml` | Wekelijkse, hervatbare uitbreiding van het langetermijnarchief. |

## Databronnen en eenheden

### Rijkswaterstaat

Locaties:

- E13: API-code `eurogeul.e13`;
- Europlatform: `europlatform`;
- J6: `j6`;
- getij en zeewatertemperatuur: `hoekvanholland`.

Belangrijkste Aquo-grootheden:

- `Hmax`: maximale golfhoogte;
- `Hm0`: significante golfhoogte;
- `Tm02`: golfperiode;
- `Th0`: golfrichting;
- `HTE3`: deiningshoogte;
- `Th3`: deiningsrichting;
- `WATHTE`: astronomische waterstand;
- `T`: temperatuur.

Golfhoogten van Rijkswaterstaat worden met factor `0.01` van centimeter naar meter omgerekend. Kwaliteitscode `99` en sentinelwaarden worden afgewezen.

### Open-Meteo

- Marine API: golf- en deiningsforecast, deiningsperiode en model-fallbacks;
- Weather API: wind, windvlagen, luchttemperatuur, zonsopkomst en zonsondergang;
- de forecast gebruikt lokale tijden in `Europe/Amsterdam`.

Zichtbare windsnelheden worden in Beaufort getoond. De ruwe km/u-waarde blijft behouden voor de scoreberekening. Verander de API-data daarom niet naar Beaufort.

## Richtingen: zeer belangrijk

Golf-, deining- en windrichtingen beschrijven **waar ze vandaan komen**. Een waarde `N` betekent dus “uit het noorden”.

- De tekst en graden blijven de herkomstrichting tonen, bijvoorbeeld `N · 343°`.
- De pijl toont de bewegingsrichting en wordt daarom visueel `+180°` gedraaid.
- Een noordelijke deining toont dus een pijl naar het zuiden.
- In “Wanneer zijn de golven goed?” wijst W–NW-deining naar O–ZO (`↘`) en oostenwind naar het westen (`←`).

Draai deze conventie niet terug zonder expliciete productbeslissing.

## Surfscore

`scoreConditions(wave, weather, weights)` in `scoring.js` retourneert `0–100` en combineert:

- golfhoogte;
- golfperiode;
- golfrichting;
- windrichting;
- windsnelheid in km/u.

De score beloont vooral bruikbare hoogte, langere periode, W–NW-deining en lichte offshore wind. Caps voorkomen dat korte windgolven, kleine golven of harde wind een onrealistisch hoge score krijgen.

De standaardgewichten zijn golfhoogte 30, golfperiode 25, golfrichting 20, windrichting 15 en windsnelheid 10. Bezoekers kunnen deze relatieve gewichten aanpassen met de schuifregelaars in de uitlegsectie. `rebalanceScoreWeights()` houdt het totaal altijd op 100%: wanneer één balk stijgt, worden de overige gewichten proportioneel verlaagd. De voorkeur wordt lokaal opgeslagen onder `surfsup-score-weights-v1`. Een wijziging herberekent hero, vijfdaagse kaarten en uurgrafiek direct. De kwaliteitscaps blijven onafhankelijk van de gewichten actief. Het is nadrukkelijk geen kanspercentage.

Voer na iedere scorewijziging `npm run check` uit en voeg nieuwe grensgevallen toe aan `scripts/check-score.mjs`.

### Waarom twee scores voor “vandaag” soms verschillen

Dit is momenteel bewust verschillende informatie:

- de grote hero-score gebruikt het huidige forecast-uur (`outlook[0]`);
- de vijfdaagse kaart “Vandaag” toont het beste resterende forecast-uur van vandaag;
- de golfgrafiek toont de score voor ieder afzonderlijk uur.

Als dit visueel verwarrend wordt, verduidelijk dan de labels “Nu” en “Beste moment vandaag”; maak de cijfers niet zonder overleg kunstmatig gelijk.

## Interface en grafieken

### Vijfdaagse surfinschatting

- eergisteren en gisteren: beste uur uit gemeten historie;
- vandaag, morgen en overmorgen: beste uur uit de forecast;
- een “beste moment” wordt alleen gekozen tussen zonsopkomst en zonsondergang;
- vandaag staat visueel centraal en groter;
- op mobiel is de horizontale kaartstrook automatisch op vandaag gecentreerd.

`fetchWeather()` vraagt twee voorbije dagen op zodat de daglichtfilter ook werkt voor eergisteren en gisteren. `weatherForecast` mag daarom niet opnieuw tot de eerste 96 uur worden afgesneden; die reeks bevat nu zowel de benodigde voorbije uren als de forecast.

### Golf- en scoregrafiek

De grafiek per boei combineert:

- gemeten significante golfhoogte;
- verwachte golfhoogte;
- gemeten laagfrequente deining (`HTE3`);
- uur-surfscore.

Bereiken: 24 uur, 7 dagen en 30 dagen historie, gevolgd door maximaal 72 uur forecast. De linker as is meter; de rechter as is score `0–100`. Hover of tik toont tijdstip, score, hoogte, periode, richting en wind.

De horizontale as gebruikt de echte timestamp van ieder datapunt, niet de index in de array. Daardoor blijven lijn, hover en tijdlabels gelijklopen wanneer er een meetuur ontbreekt of er een gat tussen meting en forecast zit.

Rijkswaterstaat biedt bij E13 geen `HTE3`-forecast aan. De grafiek toont daarom gemeten laagfrequente deining van RWS en een lange-deiningschatting vanaf “Nu”. De forecastlijn deelt het laatste beschikbare meetpunt met de meetlijn, zodat er visueel geen gat ontstaat; alle volgende punten blijven modelwaarden. RWS `HTE3` bevat alleen laagfrequente energie van 30–100 mHz (ongeveer 10–33 s). Open-Meteo levert geen volledig spectrum, maar wel hoogte, periode en voor de primaire swell een piekperiode. `long-swell.js` bouwt daarmee per primaire, secundaire en tertiaire modelpartitie een JONSWAP-vormig spectrum, integreert alleen de energie tussen 30 en 100 mHz en combineert de resulterende componenthoogten kwadratisch. Gebruik nooit rechtstreeks `swell_wave_height`: die bevat hier vaak korte golven van 4–6 s en levert een veel te hoge, onvergelijkbare lijn op. De uitkomst blijft nadrukkelijk een schatting en geen RWS-forecast.

De historische uur-score wordt berekend met boeihistorie plus de dichtstbijzijnde historische windmeting. De forecastscore gebruikt de weersverwachting bij hetzelfde uur.

### Maasvlakte en daglicht

De kaart “Weer & water” toont voor vandaag zon op en zon onder. Dezelfde `maasvlakte.daylight`-reeks begrenst het beste moment in de hero en in alle vijf dagkaarten. De actuele surfscore zelf blijft ook buiten daglicht zichtbaar; alleen de aanbeveling “beste moment” is gefilterd.

## Tijdzones

Alle presentatie hoort bij `Europe/Amsterdam`.

Let op: `parseTime()` in `app.js` voegt voor tijdstrings zonder zone momenteel expliciet `+02:00` toe. Dat werkt in de zomertijd, maar kan in de winter één uur afwijken. `dayKeyForTime()` voorkomt al dat lokale forecastdagen verkeerd gegroepeerd worden. Een toekomstige verbetering is zonecorrect parsen voor zowel CET als CEST.

## Automatische updates en deployment

- `pages.yml`: ieder uur op minuut 12, plus iedere push naar `main`;
- `history.yml`: iedere nacht om 02:27 UTC;
- `archive.yml`: iedere zondag om 04:47 UTC.

De Pages-build vervangt `__ASSET_VERSION__` in `index.html` en `app.js` door `GITHUB_SHA`. Dit voorkomt dat browsers een oude `app.js`, `styles.css` of `scoring.js` uit cache gebruiken. **Verwijder deze placeholders of de `sed`-stappen niet.**

Een botcommit vanuit de history- of archiveworkflow start mogelijk niet direct een andere workflow; de volgende uurlijkse Pages-run publiceert de bestanden alsnog.

## Werkwijze voor wijzigingen

1. Lees eerst de relevante functies en bestaande CSS; de site heeft bewust geen buildtool.
2. Houd de interface in het Nederlands.
3. Gebruik `apply_patch` voor handmatige wijzigingen.
4. Bewaar bestaande, niet-gerelateerde wijzigingen in de worktree.
5. Voer minimaal uit:

   ```bash
   npm run check
   git diff --check
   ```

6. Test visuele veranderingen lokaal op desktop én ongeveer `390 × 844` mobiel.
7. Controleer dat de pagina geen horizontale body-overflow of browserconsolefouten heeft.
8. Push of publiceer alleen als de gebruiker dat vraagt of de lopende taak duidelijk publicatie omvat.
9. Controleer na publicatie zowel de GitHub Actions-run als de live pagina.

## Bekende technische aandachtspunten

- `data/archive.json` is nog onvolledig en groeit stapsgewijs; lage coverage in oude maanden is normale brondata, geen garantie van volledige metingen.
- Open-Meteo-waarden zijn modeldata. De interface markeert model/fallbackwaarden met een sterretje waar relevant.
- Het getijcoëfficiënt is een lokale relatieve schaal `20–120`, berekend uit de astronomische getijslag; het is geen officiële Franse getijcoëfficiënt.
- GitHub Actions kan waarschuwingen tonen over actions die intern een oudere Node-runtime gebruiken. De workflows werken momenteel, maar controleer officiële action-upgrades voordat versies worden aangepast.
- Voeg geen API-sleutels, backend of database toe zolang de bestaande openbare databronnen en statische architectuur voldoen.
