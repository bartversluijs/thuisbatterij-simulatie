# Thuisbatterij Simulatie

Web-based simulatietool voor het berekenen van potentiële besparingen en winsten met een thuisbatterij. Simuleer arbitrage op de EPEX markt, of realistische scenario's met zonnepanelen en huishoudelijk verbruik.

🔗 **Live demo:** https://mark-vis.github.io/thuisbatterij-simulatie/

## Features

### Algemeen
- ✅ 100% client-side (privacy vriendelijk - geen data naar server)
- ✅ Simulatie voor jaren 2013-2025
- ✅ Configureerbare batterijparameters (capaciteit, vermogen, efficiëntie, SoC limieten)
- ✅ Vier prijs modes: Standaard met/zonder salderen (Tibber 2025), Kaal (EPEX), Geavanceerd (eigen formules)
- ✅ Interactieve grafieken met Chart.js
- ✅ CSV export en URL sharing
- ✅ Responsive design (werkt op mobiel en desktop)

### Arbitrage Simulatie (index.html)
- ✅ EPEX Day-Ahead arbitrage (koop laag, verkoop hoog)
- ✅ Maandelijks en dagelijks overzicht
- ✅ Detail view per uur met SoC grafiek
- ✅ Drill-down navigatie: maand → dag → uur

### Simulatie met PV (with_solar.html)
- ✅ **Realistische scenario's** met zonnepanelen en huishoudelijk verbruik
- ✅ **4 scenario's vergelijking**: Vast/Dynamisch contract, met/zonder batterij
- ✅ **Verbruiksprofielen**: Basis (~3,5 MWh/jaar), +Warmtepomp (+3 MWh), +EV (+3 MWh), +WP+EV
- ✅ **PV-profielen**: 0-10 kWp met realistische zonnehoek en wolkendekking voor Nederland
- ✅ **Zelfverbruik en zelfvoorziening** metrics
- ✅ **Besparingen analyse**: Batterij effect, dynamisch contract effect, totale besparing

### Geavanceerde Analyse (advanced.html)
- ✅ **Vermogensscan**: Grid search over laad/ontlaadvermogen
- ✅ **Efficiëntiecurves**: Victron MultiPlus 5000 (vermogensafhankelijke efficiëntie)
- ✅ **Optimale configuratie**: Vind beste vermogen voor jouw situatie
- ✅ **Heatmap visualisatie**: 2D grid van alle combinaties

### Eigen P1 Data (custom_data.html)
- ✅ **Upload eigen P1 meter data**: CSV format met import/export meterstanden
- ✅ **Automatische interval detectie**: Ondersteunt 5 min, 15 min, 60 min, etc.
- ✅ **Kwartier prijsdata ondersteuning**: Gebruikt 15-min of 60-min prijzen vanaf oktober 2025
- ✅ **4 scenario's vergelijking**: Vast/Dynamisch contract, met/zonder batterij
- ✅ **Drill-down navigatie**: maand → dag → uur/kwartier met batterij gedrag
- ✅ **Besparingen analyse**: Gedetailleerde vergelijking van alle scenario's

## Technologie

- **Frontend**: Vanilla JavaScript (geen frameworks)
- **Charts**: Chart.js 4.4.0
- **Optimizer**: MILP met HiGHS solver (WebAssembly)
- **Data**: Historische EPEX prijsdata (2013-2025)

## Structuur

```
site/
├── index.html                      # Arbitrage simulatie
├── with_solar.html                 # Simulatie met PV en verbruik
├── advanced.html                   # Geavanceerde analyse (vermogensscan)
├── custom_data.html                # Simulatie met eigen P1 data
├── technical.html                  # Technische details
├── about.html                      # Over pagina
├── legal.html                      # Disclaimer
├── css/
│   └── style.css                   # Styling
├── js/
│   ├── battery.js                  # Battery class (charge/discharge)
│   ├── optimizer.js                # MILP optimizer (HiGHS solver)
│   ├── simulator.js                # Arbitrage simulator
│   ├── solar_simulator.js          # PV + verbruik simulator
│   ├── custom_data_simulator.js    # Simulator voor eigen P1 data
│   ├── p1_parser.js                # P1 CSV parser met interval detectie
│   ├── ui.js                       # UI arbitrage
│   ├── solar_ui.js                 # UI met PV
│   ├── custom_data_ui.js           # UI voor eigen P1 data
│   ├── charts.js                   # Chart.js visualisaties
│   ├── efficiency_curves.js        # Victron efficiency curves
│   ├── power_sweep.js              # Vermogensscan logica
│   ├── advanced_ui.js              # UI geavanceerde analyse
│   └── lib/                        # HiGHS solver (WebAssembly)
├── data/
│   ├── prices_2024.json            # EPEX prijzen per jaar (uurlijks)
│   ├── prices_2025.json            # EPEX prijzen 2025 (kwartier vanaf okt)
│   ├── consumption_2024_basis.json # Verbruiksprofielen
│   ├── consumption_2024_wp.json
│   ├── consumption_2024_ev.json
│   ├── consumption_2024_wp_ev.json
│   ├── solar_2024_0kwp.json        # PV-profielen (0-10 kWp)
│   ├── solar_2024_5kwp.json
│   └── ...
├── generate_test_data.py           # Python script voor genereren test data
└── README.md
```

## Gebruik

### Lokaal testen

1. Open `index.html` in een moderne browser (Chrome, Firefox, Safari, Edge)
2. Of draai een lokale webserver:

```bash
# Python 3
python -m http.server 8000

# Of Node.js
npx serve
```

3. Open http://localhost:8000 in je browser

### Deployment

**GitHub Pages:**
1. Push naar GitHub repository
2. Enable GitHub Pages in repository settings
3. Select branch (main) en root directory

**Netlify/Vercel:**
1. Connect repository
2. Deploy (geen build stappen nodig)

## Data

### EPEX Prijsdata
De EPEX prijsdata is opgeslagen in JSON formaat in de `data/` directory. Elk bestand bevat de uurlijkse prijzen voor een specifiek jaar:

```json
{
  "year": 2024,
  "count": 8784,
  "prices": [
    {"timestamp": "2024-01-01T00:00:00", "price": 45.23},
    {"timestamp": "2024-01-01T01:00:00", "price": 42.18},
    ...
  ]
}
```

Prijzen zijn in EUR/MWh. De simulator converteert deze intern naar EUR/kWh voor de berekeningen.

### Verbruiks- en PV-data (2024)
Realistische profielen gegenereerd met `generate_test_data.py`:

**Verbruiksprofielen** (8784 uur voor 2024):
- `consumption_2024_basis.json`: ~3,5 MWh/jaar (standaard NL huishouden)
- `consumption_2024_wp.json`: ~6,8 MWh/jaar (+ warmtepomp, 3 MWh extra)
- `consumption_2024_ev.json`: ~6,0 MWh/jaar (+ EV, 15000 km @ 20 kWh/100km)
- `consumption_2024_wp_ev.json`: ~9,3 MWh/jaar (+ warmtepomp + EV)

**PV-profielen** (8784 uur voor 2024):
- `solar_2024_0kwp.json` t/m `solar_2024_10kwp.json`: 0-10 kWp systemen
- Realistische zonnehoek berekening voor Nederlandse breedtegraad (52°N)
- Willekeurige wolkendekking (seizoensafhankelijk)

## Ontwikkeling

De simulator is gebaseerd op een niet-publieke Python implementatie en volledig herschreven in JavaScript.

**Python versie (niet publiek):**
- Gebruikt PuLP voor MILP optimization
- Day-ahead planning
- Detailed efficiency curves (Victron MultiPlus 5000)

**JavaScript versie (deze repository):**
- HiGHS solver voor MILP optimization (exact dezelfde formulering als Python)
- Zelfde planning logica (day-ahead om 13:00)
- Basis simulaties (index.html, with_solar.html): constante efficiency (instelbaar, standaard 89%, niet vermogensafhankelijk)
- Geavanceerde analyse (advanced.html): vermogensafhankelijke efficiency curves (Victron MultiPlus 5000)

### Modelleringsparameters

**Vast verbruik omvormer (`fixed_consumption_w`, W)** — *Fase 1*

Constant sluimer-/bedrijfsverbruik dat de omvormer trekt zodra hij aanstaat
(~50–85 W voor een 3-fase hybride omvormer). Dit is een continue drain die
**niet meeschaalt met doorzet** en daarom apart wordt gemodelleerd i.p.v.
verstopt in de round-trip efficiëntie.

- **Eenheid:** Watt (canonieke interne eenheid). Omrekenen: `kWh/dag = W × 24 / 1000`, dus `W = kWh/dag × 1000 / 24`.
- **Standaard:** `0` W → geen effect (bestaande configuraties blijven identiek).
- **Realistisch:** 50–85 W. Jaarverbruik ≈ `W × 8,76` kWh/jaar.
- **Waar onttrokken (gedocumenteerde constante):** uit de batterij zolang SoC
  boven Min SoC ligt; het tekort wordt door het net geleverd (verhoogt import /
  verlaagt export tegen de inkoopprijs). Kan SoC nooit onder Min SoC trekken.
- **Toepassing:** alleen in scenario's *mét* batterij (geen batterij = geen
  omvormer = geen sluimerverbruik). Beschikbaar op alle pagina's onder
  "Geavanceerd (verliezen)". De tijdstap `dt` wordt uit de data afgeleid, dus
  ook kwartierdata (0,25 h) wordt correct verwerkt.
- **Output ter validatie:** na de simulatie toont de resultatensectie het totale
  sluimerverbruik in kWh over de gesimuleerde periode, met een geannualiseerde
  schatting (`≈ kWh/jaar`) op basis van de werkelijke datalengte. De tegel is
  verborgen zolang het veld op 0 staat.

**Rendement splitsen: batterij × omvormer** — *Fase 2*

De twee efficiëntievelden (laden/ontladen) bundelen normaal twee fysiek
verschillende verliezen: cel-/DC-DC-verlies in de **batterij** en AC↔DC-conversie
in de **omvormer**. In "Geavanceerd (verliezen)" kun je die twee stadia apart
opgeven, zodat ze onafhankelijk kunnen bewegen (bv. bij het vergelijken van
omvormers of LV/HV-systemen).

- **Modus (schakelaar):**
  - *Gecombineerd* (standaard): je vult de twee bestaande velden
    Laad-/Ontlaadefficiëntie in — identiek aan het gedrag vóór Fase 2.
  - *Gesplitst* (vinkje "Rendement splitsen"): je vult vier velden in en het
    effectieve rendement per richting is het product van beide stadia:
    - `chargeEfficiency    = batterij_laden × omvormer_laden`
    - `dischargeEfficiency = batterij_ontladen × omvormer_ontladen`
- **Eenheid:** procenten (%) per stadium, per richting.
- **Standaard:** vinkje uit → de twee gecombineerde velden gelden ongewijzigd
  (bestaande configuraties en gedeelde URLs blijven identiek). Bij aanzetten:
  ~98% batterij en ~97% omvormer per richting (round-trip ≈ 91%).
- **Effect op het model:** puur op configuratie-niveau. De verliesketen
  (net/PV → omvormer → batterij → omvormer → verbruik) wordt teruggebracht tot
  dezelfde twee gecombineerde getallen die de simulator al gebruikt; Battery,
  simulatoren en optimizers blijven ongewijzigd.
- **Beschikbaar op:** arbitrage (index.html), PV + verbruik (with_solar.html) en
  Eigen Data (custom_data.html) — de pagina's met handmatige efficiëntie-invoer.
  De geavanceerde analyse (advanced.html) gebruikt vermogensafhankelijke curves
  en heeft deze splitsing niet.

**Deellast-rendement omvormer** — *Fase 3*

Een omvormer is niet even efficiënt bij elk vermogen: bij laag vermogen (enkele
honderden watt) zakt het rendement duidelijk t.o.v. bijna-nominale belasting.
Avond-basislasten worden vaak bij laag vermogen bediend — precies waar het
rendement het slechtst is — dus een enkel vlak rendementsgetal *overschat* de
werkelijke opbrengst bij laag-vermogen laden/ontladen systematisch.

- **Velden ("Geavanceerd (verliezen)", vinkje "Deellast-rendement omvormer"):**
  - `low_power_eff` — Rendement bij laag vermogen (%), toegepast onder de drempel.
  - `low_power_threshold_kw` — Drempelvermogen (kW); erboven geldt het nominale
    (vlakke) rendement uit de velden Laad-/Ontlaadefficiëntie.
  - *Lineair interpoleren* (aan als standaard): laat het rendement lineair
    oplopen van `low_power_eff` (bij 0 kW) naar nominaal (bij de drempel), zodat
    er geen sprong op de grens ontstaat. Uit = harde stap onder de drempel.
- **Eenheid:** rendement in procenten (%), drempel in kW (DC-vermogen).
- **Effect op het model:** per tijdstap wordt het momentane DC-vermogen berekend
  (energie / tijdstap `dt`) en daarmee het toe te passen rendement bepaald, in
  plaats van een vast getal. Het is een *penalty*-model: het rendement kan nooit
  boven nominaal uitkomen, alleen eronder. `dt` wordt uit de data afgeleid.
- **Standaard:** vinkje uit → geen effect; bestaande configuraties en gedeelde
  URLs blijven identiek.
- **Interactie met dispatch:** grotere, minder frequente blokken (zoals een
  externe energiemanager als EVCC kan afdwingen) houden de omvormer uit het
  laag-rendementsgebied. Dit verklaart waarom slim schakelen de werkelijke
  opbrengst verhoogt boven pure arbitrage.
- **Beschikbaar op:** arbitrage (index.html), PV + verbruik (with_solar.html) en
  Eigen Data (custom_data.html). De geavanceerde analyse (advanced.html) gebruikt
  al vermogensafhankelijke curves (Victron) en heeft deze optie niet nodig.

**Capaciteitsdegradatie over de levensduur** — *Fase 4*

Terugverdientijd wordt over 10–15 jaar bekeken, maar de bruikbare capaciteit is
niet constant: een LFP-pakket zakt richting de einde-levensduurgrens (vaak
~70–80% van nominaal na de gegarandeerde cycli). Dit negeren *overschat* de
besparing in de latere jaren.

Omdat de simulatie één jaar data doorrekent, kan één run niet de hele levensduur
beslaan. Daarom gebruikt de simulatie de **gemiddelde bruikbare capaciteit over
de analysehorizon** — een representatief getal voor een typisch jaar uit die
levensduur. Bij lineaire afname is dat gelijk aan de capaciteit halverwege de
levensduur.

- **Velden ("Geavanceerd (verliezen)", keuzelijst "Capaciteitsdegradatie"):**
  - *Geen* (standaard) — geen effect.
  - *Per jaar*: `degradation_rate` in **%/jaar** (bijv. 2%/jaar).
  - *Per cyclus*: `degradation_rate` in **%/cyclus** plus een schatting
    *cycli per jaar* (één jaar data heeft nog geen eigen levensduur-cyclustelling;
    de per-cyclus modus vermenigvuldigt de schatting × leeftijd tot cumulatieve
    cycli). Een gemeten cycli/jaar kan later uit Fase 5 (doorzet/EFC) komen.
  - `end_of_life_floor` — *Ondergrens einde levensduur (%)*: capaciteit wordt hier
    op geklemd (standaard 70%), degradeert nooit naar nul.
  - `horizon_years` — *Analysehorizon (jaar)*: de periode waarover de gemiddelde
    capaciteit wordt bepaald (standaard 15 jaar).
- **Model:** afname is **lineair** en geklemd op de ondergrens; de effectieve
  capaciteit = nominaal × gemiddelde capaciteitsfractie over de horizon. Alleen de
  bruikbare capaciteit verandert; de fysica per tijdstap blijft ongewijzigd. Een
  live hint toont de gemiddelde en einde-horizon capaciteit ter controle.
- **Standaard:** *Geen* → geen effect; bestaande configuraties en gedeelde URLs
  blijven identiek.
- **Beschikbaar op:** arbitrage (index.html), PV + verbruik (with_solar.html) en
  Eigen Data (custom_data.html), inclusief de vermogensscan op de Eigen Data-pagina.

**Doorzet & volledige cycli (equivalent full cycles)** — *Fase 5*

Dit is een **uitvoer**, geen invoer: het rekent niets aan de fysica, maar meet de
energie die daadwerkelijk door de batterij is gegaan. Zo kun je elke
rendements- en capaciteitsaanname *valideren* tegen het resultaat, en het voedt
de per-cyclus degradatie van Fase 4.

- **Getoonde waarden (naast de financiële resultaten):**
  - *Volledige cycli per jaar* — jaarlijkse ontladen doorzet ÷ bruikbare
    capaciteit (equivalent full cycles, EFC). De doorzet wordt op de **DC-zijde**
    (aan de batterij) gemeten, consistent met de bruikbare capaciteit, zodat een
    EFC fysiek betekenis heeft. Gebruikt de *effectieve* (na-degradatie)
    capaciteit uit Fase 4 als noemer.
  - *Jaarlijkse doorzet (kWh)* — geleverde (ontladen) energie per jaar.
  - *Vermogen begrensd* — percentage tijdstappen waarin het geleverde vermogen
    tegen de DC-vermogenslimiet aanliep, plus het waargenomen piekvermogen.
    Veel begrenzing betekent dat het **vermogen** (kW) de beperkende factor is,
    niet de capaciteit (kWh) — nuttig bij het dimensioneren.
- **Normalisatie per jaar:** cijfers worden geschaald naar de **werkelijke
  tijdspanne van de dataset** (afgeleid uit de tijdstempels; een jaar = 8760 h),
  zodat een dataset die geen heel aantal jaren beslaat correct wordt
  geëxtrapoleerd. Overgeslagen NULL-rijen tellen niet mee.
- **Standaard:** puur additief; de kaarten verschijnen alleen als de batterij
  daadwerkelijk cyclet. Runs zonder batterijactiviteit blijven ongewijzigd.
- **Beschikbaar op:** arbitrage (index.html), PV + verbruik (with_solar.html) en
  Eigen Data (custom_data.html).

**Noodreserve SoC (`backup_reserve_soc`, %)** — *Fase 6c*

Een aparte **noodreserve** die apart staat van de veiligheids-`Min SoC`.
`Min SoC` is de absolute hardware-ondergrens die nooit wordt onderschreden — maar
een batterij die op `Min SoC` staat heeft niets meer over om het huis te voeden
bij een stroomstoring. De noodreserve reserveert daarvoor een hogere buffer:

    Min SoC  ≤  Noodreserve SoC  ≤  Max SoC
    └ absolute       └ handels-/ontlaadondergrens: energie hieronder wordt
      hardware         achtergehouden voor stroomuitval en is níet beschikbaar
      ondergrens       voor arbitrage of zelfconsumptie.

- **Model:** handel en zelfconsumptie mogen alleen de band `[Noodreserve, Max SoC]`
  gebruiken; zowel de MILP-optimizer als de ontlaadstap hanteren deze ondergrens.
  Het **sluimerverbruik** (Fase 1) mag wél tot `Min SoC` teren — dat is precies
  het soort verbruik dat de reserve tijdens een storing moet dekken.
- **Kosten:** een hogere reserve levert minder handelsopbrengst op, omdat de
  bruikbare cyclusdiepte kleiner wordt. Voorbeeld (10 kWh / 5 kW, 2024, Tibber
  standaard mét salderen; jaarwinst zonder reserve ≈ €381):

  | Noodreserve | Bruikbare band | Jaarwinst | vs. geen reserve |
  |-------------|----------------|-----------|------------------|
  | geen (10%)  | 10–100%        | €381      | —                |
  | 20%         | 20–100%        | €344      | −€37 (−9,8%)     |
  | 30%         | 30–100%        | €307      | −€75 (−19,6%)    |
  | 50%         | 50–100%        | €232      | −€149 (−39,2%)   |

  Vuistregel: elke ~10%-punt extra reserve kost hier ruwweg €35–40/jaar aan
  gemiste arbitrage. Het exacte bedrag hangt af van capaciteit, tarief en jaar —
  vul je eigen waarden in en vergelijk de jaarwinst met en zonder reserve.
- **Velden ("Geavanceerd (verliezen)", veld "Noodreserve SoC"):** één percentage;
  moet ≥ `Min SoC` en < `Max SoC` zijn (anders een duidelijke foutmelding).
- **Standaard:** leeg of gelijk aan `Min SoC` → geen reserve; bestaande
  configuraties en gedeelde URLs blijven identiek.
- **Beschikbaar op:** arbitrage (index.html), PV + verbruik (with_solar.html) en
  Eigen Data (custom_data.html), inclusief de vermogensscan op de Eigen Data-pagina.

Zie `PLAN.md` voor de bredere roadmap van modelleringsverbeteringen.

### Implementatie Status

- [x] Vast verbruik omvormer / parasitair verlies (Fase 1, alle pagina's)
- [x] Rendement splitsen in batterij × omvormer (Fase 2, handmatige-invoer pagina's)
- [x] Deellast-rendement omvormer (Fase 3, handmatige-invoer pagina's)
- [x] Capaciteitsdegradatie over levensduur (Fase 4, handmatige-invoer pagina's)
- [x] Doorzet & volledige cycli (EFC) als uitvoer (Fase 5, alle pagina's)
- [x] Noodreserve SoC apart van Min SoC (Fase 6c, handmatige-invoer pagina's)
- [x] MILP solver (HiGHS via WebAssembly)
- [x] PV productie integratie (0-10 kWp profielen)
- [x] Eigen verbruik profielen (basis, WP, EV, WP+EV)
- [x] Efficiency curves (Victron MultiPlus 5000, vermogensafhankelijk)
- [x] 4 scenario's vergelijking (vast/dynamisch, met/zonder batterij)
- [x] Greedy strategie voor vaste prijzen (zelfverbruik maximalisatie)
- [x] P1 meter data upload (CSV format)
- [x] Kwartier prijsdata ondersteuning (15-min granulariteit vanaf oktober 2025)
- [x] Drill-down navigatie met interactieve grafieken

### Toekomstige Verbeteringen

- [ ] Meer jaren voor verbruik/PV data (nu alleen 2024)
- [ ] Meer verbruiksprofielen (airco, zwembad, etc.)
- [ ] Optimalisatie algoritme voor vermogensscan (gradient descent)

## Contact

Ontwikkeld door **prof. Mark Vis**, universitair docent aan de TU/e.

- **Live demo:** https://mark-vis.github.io/thuisbatterij-simulatie/
- Email: m.vis@tue.nl
- TU/e profiel: https://www.tue.nl/en/research/researchers/mark-vis

## Credits

- EPEX prijsdata: Met dank aan [jeroen.nl](https://jeroen.nl/) voor historische prijzen
- Chart.js: https://www.chartjs.org/
- HiGHS solver: [highs-js](https://github.com/lovasoa/highs-js)

## Licentie

© Mark Vis - Licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)

Deze software mag gebruikt worden voor niet-commerciële doeleinden. Voor commercieel gebruik, neem contact op met m.vis@tue.nl
