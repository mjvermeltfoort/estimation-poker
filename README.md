# Estimation Poker

Estimation Poker is een kleine interne webapp waarmee teams tickets onafhankelijk in uren schatten. Een facilitator kiest het actieve ticket, ziet wie al heeft gestemd, onthult alle stemmen tegelijk en legt na het teamgesprek een definitieve schatting vast.

De eerste versie ondersteunt teams, sessies, handmatig ingevoerde Jira-tickets, blinde stemrondes, basisstatistieken, meerdere rondes en het afronden van een sessie. Er is geen buildstap of frontendframework nodig.

## Architectuur

```text
GitHub Pages static frontend
        ↓
Google Apps Script Web App
        ↓
Google Sheet
```

De frontend bestaat uit HTML5, moderne CSS en vanilla JavaScript ES modules. Alle browserrequests lopen via de centrale API-client. Hash-routing maakt de app geschikt voor een GitHub Pages-projectsite zonder server-side routefallback.

## Projectstructuur

```text
.
├── .github/workflows/pages.yml   # GitHub Pages-deployment
├── site/
│   ├── index.html                # app-shell
│   ├── 404.html                  # statische foutpagina
│   ├── .nojekyll
│   ├── favicon.svg
│   ├── css/styles.css
│   └── js/
│       ├── app.js                # opstarten, routes en polling koppelen
│       ├── api.js                # alle Fetch API-communicatie
│       ├── config.js             # Apps Script-URL en time-outs
│       ├── router.js             # hash-routing
│       ├── state.js              # kleine centrale state
│       ├── storage.js            # veilige browseropslag
│       ├── polling.js            # adaptieve, niet-overlappende polling
│       ├── notifications.js      # toegankelijke meldingen
│       ├── utils.js              # DOM-, status- en statistiekhelpers
│       └── views/                # routeviews
├── AGENTS.md
├── LICENSE
├── tests/smoke.mjs              # frameworkloze router- en statistiektests
└── README.md
```

## Configuratie

Open [`site/js/config.js`](site/js/config.js) en vervang:

```javascript
apiUrl: "PLAATS_HIER_DE_GOOGLE_APPS_SCRIPT_EXEC_URL"
```

door de gepubliceerde Google Apps Script-URL die eindigt op `/exec`. De URL is geen geheim, maar hoort op slechts één plek te staan. Zolang de placeholder aanwezig is, toont de app een configuratiemelding en doet hij bewust geen netwerkrequests.

## Lokaal starten

Start vanuit de repositoryroot:

```bash
python3 -m http.server 8080 --directory site
```

Open daarna [http://localhost:8080](http://localhost:8080). Gebruik niet rechtstreeks `file://`: ES modules en browserbeveiliging maken dat onbetrouwbaar.

## Apps Script publiceren

1. Open de Google Sheet.
2. Kies `Extensies → Apps Script`.
3. Plaats of open het Apps Script dat het gedocumenteerde backendcontract uitvoert.
4. Kies `Implementeren → Nieuwe implementatie`.
5. Kies `Web-app`.
6. Laat de app uitvoeren als de eigenaar.
7. Geef de gewenste toegang voor de interne MVP.
8. Kopieer de implementatie-URL die eindigt op `/exec`.
9. Plaats die URL in `site/js/config.js`.

Een `/dev`-URL is alleen voor testen door bevoegde scripteditors en is niet geschikt voor de gepubliceerde frontend.

## Routes

| Hash-route | Functie |
| --- | --- |
| `#/` | Teams en sessies bekijken |
| `#/sessions/new` | Nieuwe conceptsessie aanmaken |
| `#/session/{sessionId}` | Deelnemen en stemmen |
| `#/session/{sessionId}?member={memberId}` | Deelnemen met vooraf gekozen teamlid |
| `#/facilitate/{sessionId}` | Sessie faciliteren |

## GitHub Pages activeren

1. Open de repository op GitHub.
2. Ga naar `Settings`.
3. Ga naar `Pages`.
4. Selecteer bij `Source` de optie `GitHub Actions`.
5. Push naar `main` of start `Deploy GitHub Pages` handmatig.
6. Controleer de deployment onder `Actions`.
7. Open de URL die bij de deployment wordt getoond.

De workflow valideert de essentiële bestanden, uploadt uitsluitend `site/` en deployt naar de `github-pages` environment. Alle assets gebruiken relatieve paden, zodat een projectsite onder `gebruikersnaam.github.io/repositorynaam/` werkt.

## Beveiligingsbeperkingen

- Er is nog geen echte login.
- Teamlid- en facilitatorselectie zijn geen authenticatie of autorisatie.
- Iedereen met de Pages-link kan de frontend benaderen.
- Een Apps Script Web App die voor iedereen toegankelijk is, is publiek bereikbaar.
- Zet nooit Jira-tokens, API-sleutels of andere geheimen in de frontend.
- Deze versie is een interne MVP; gebruik hem niet als beveiligd extern product.
- Bewaar geen gevoelige of vertrouwelijke informatie in de gekoppelde Sheet.
- Rollen worden in de interface gebruikt, maar niet veilig afgedwongen.

## Bekende beperkingen

- De app gebruikt polling in plaats van realtime WebSockets.
- Jira-tickets worden handmatig ingevoerd; er is geen Jira-koppeling.
- Er zijn geen veilige accounts, rollen of backendautorisatie.
- Informatie over de actieve ronde staat deels in `sessionStorage`; een gedeeld backend-rondenummer verdient de voorkeur in een volgende versie.
- Er is geen offlineondersteuning of service worker.
- Er is geen automatisch statistiekendashboard of historische rapportage.
- Apps Script en Google Sheets zijn niet bedoeld voor grote aantallen gelijktijdige gebruikers.

## Deploymentproblemen oplossen

- **Workflow faalt:** controleer in Actions welke validatie of Pages-stap faalt en bevestig dat `site/index.html`, `site/css/styles.css`, `site/js/app.js` en `site/.nojekyll` bestaan.
- **Geen Pages-URL:** zet onder `Settings → Pages` de source op `GitHub Actions`.
- **Configuratiemelding blijft staan:** vervang de placeholder in `site/js/config.js` en push opnieuw.
- **CORS- of redirectfout:** controleer dat Apps Script als Web App is gepubliceerd, de juiste toegang heeft en dat POSTs `text/plain;charset=utf-8` gebruiken.
- **Verkeerde URL:** gebruik de `/exec`-URL, niet `/dev` en niet de editor-URL.
- **CSS of modules laden niet:** controleer dat assetpaden relatief zijn en niet met `/` beginnen.
- **Oude versie zichtbaar:** voer een harde refresh uit of wis de browsercache nadat de Pages-deployment gereed is.

## Handmatige acceptatietests

Zonder een echte Apps Script-backend kan altijd het configuratiescenario worden uitgevoerd:

1. Start de app met de placeholder-URL.
2. Bevestig dat de waarschuwing zichtbaar is.
3. Bevestig dat de app blijft werken en geen API-requests uitvoert.

Met demo-records (`team-demo`, `session-demo`, `ticket-demo`, `member-demo`) kan de volledige stemflow worden getest: stem als deelnemer, controleer dat vóór reveal alleen “Gestemd” in de DOM staat, onthul als facilitator, sla de definitieve schatting op en start een nieuwe ronde. Test de deelnemerslink ook vanaf een GitHub Pages-projectsubdirectory.

Wanneer GJS beschikbaar is, draaien de frameworkloze smoke tests met:

```bash
gjs -m tests/smoke.mjs
```

## Licentie

Dit project is beschikbaar onder de [MIT-licentie](LICENSE).
