# SurfsUp

Een rustig, mobielvriendelijk surf-dashboard voor de Maasvlakte. De site combineert actuele metingen van drie Rijkswaterstaat-boeien met wind, getij, zeewatertemperatuur, maanstand en een praktische surfinschatting.

## Wat staat erop?

- Eurogeul E13, Europlatform en J6: maximale en significante golfhoogte, golfperiode en -richting, deiningshoogte, -periode en -richting.
- Een grafiek met 24 uur gemeten golfhistorie en 72 uur verwachting.
- Maasvlakte: volgend hoog- en laagwater, getijcoëfficiënt, wind, lucht- en zeewatertemperatuur.
- Maanstand en verlichting.
- Een surfscore die golfhoogte, periode, richting en wind combineert.

De score is nadrukkelijk een indicatie en geen veiligheidsadvies.

## Databronnen

- [Rijkswaterstaat Waterdata](https://rijkswaterstaatdata.nl/waterdata/) voor de boeimetingen, zeewatertemperatuur en het astronomisch getij van Hoek van Holland, de dichtstbijzijnde officiële getijlocatie.
- [Open-Meteo](https://open-meteo.com/) voor wind en luchttemperatuur.
- [Open-Meteo Marine](https://open-meteo.com/en/docs/marine-weather-api) voor de golfverwachting en deiningsperiode. Een sterretje in de interface markeert modeldata.

De workflow haalt ieder uur nieuwe data op en publiceert daarna automatisch een verse GitHub Pages-versie. Er zijn geen API-sleutels nodig.

## Lokaal bekijken

Node.js 20 of nieuwer is voldoende:

```bash
npm run data
npm run serve
```

Open daarna `http://localhost:4173`.

## Publiceren op GitHub Pages

Bij een push naar `main` start de workflow automatisch. Mocht GitHub Pages nog niet actief zijn, kies dan in de repository bij **Settings → Pages → Source** voor **GitHub Actions** en start de workflow nogmaals.

De verwachte URL is:

```text
https://ruben-j.github.io/SurfsUp/
```

## In WordPress plaatsen

Zodra GitHub Pages online staat, kan de hele surfcheck in een WordPress-blok met aangepaste HTML worden ingebed:

```html
<iframe
  src="https://ruben-j.github.io/SurfsUp/"
  title="Actuele surfcondities Maasvlakte"
  width="100%"
  height="1400"
  style="border:0; border-radius:18px;"
  loading="lazy">
</iframe>
```

Sommige WordPress-hosters verwijderen `iframe`-elementen. In dat geval kan de pagina als gewone link of via een iframe/plugin van de hoster worden toegevoegd.

## Technische keuzes

De site gebruikt alleen HTML, CSS en JavaScript. De gegevens worden tijdens de GitHub Actions-run opgehaald en als statisch JSON-bestand meegepubliceerd. Daardoor zijn er geen geheime sleutels, server of betaalde hosting nodig en blijft de pagina snel.
