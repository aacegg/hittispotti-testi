/* HittiSpotti – musiikkivisa suomalaisilla biiseillä.
 * Pelkkää selain-JavaScriptiä: ei build-vaihetta, ei riippuvuuksia.
 */
(() => {
  "use strict";

  // ---------- Säännöt ----------
  const STEPS = [0.1, 0.5, 2, 8, 15];          // pätkän pituus sekunteina
  /* Pisteet putoavat suhteellisesti, eivät tasaisesti: joka askel maksaa noin
   * 29 % siitä mitä pelaajalla oli. Pätkän pituus moninkertaistuu askeleittain
   * (0,1 -> 0,5 on viisinkertainen määrä ääntä), joten tasainen pudotus teki
   * ensimmäisistä askelista liian halpoja ohittaa ja viimeisistä liian
   * kalliita. Maksimi pysyy 1200:ssa, jotta vanhat tulokset ovat vertailu-
   * kelpoisia. Ohjeteksti index.html:ssä toistaa nämä luvut. */
  const POINTS = [1200, 850, 600, 425, 300];   // pisteet, jos tunnistat tällä askeleella
  const DAILY_COUNT = 5;
  const TIER_CYCLE = [1, 2, 3, 4, 5];          // yksi biisi jokaiselta tasolta, helpoimmasta vaikeimpaan
  const TIER_NAMES = { 1: "Helppo", 2: "Keskitaso", 3: "Vaikea", 4: "Mestari", 5: "Mahdoton" };
  const STORE = "hittispotti:";
  const STORE_OLD = "songspot-suomi:";         // aiempi nimi, tiedot siirretään kerran
  const RING = 2 * Math.PI * 54;               // soittopainikkeen kehän pituus (r = 54)
  /* Katalogilla on oma versionumeronsa, jota nostetaan vain kun songs.json
   * muuttuu. Näin selain ja service worker saavat pitää 780 kt:n tiedoston
   * välimuistissa tyylimuutosten yli, mutta uusi katalogi on eri osoite ja
   * tulee varmasti perille – vanha versio antaisi pelaajalle eri päivän
   * biisit kuin muille. */
  const KATALOGI = "songs.json?k=7";

  // ---------- Tila ----------
  const state = {
    songs: [],           // kaikki – näistä haetaan ja arvataan
    pool: [],            // näistä peli jakaa biisit
    byId: new Map(),
    mode: "daily",        // "daily" | "free"
    dayKey: null,         // minkä päivän sarja on auki – ei kellosta, ks. startDaily
    rounds: [],           // biisikohtaiset tilat, päivän pelissä viisi
    at: 0,                // mikä niistä on auki
    used: new Set(),
    results: [],
    score: 0,
    selected: null,
    suggestions: [],
    activeSuggestion: -1,
    view: "loading",
  };

  const audio = {
    ctx: null,
    buffers: new Map(),   // id -> AudioBuffer
    starts: new Map(),    // id -> pätkän aloituskohta sekunteina
    source: null,
    gain: null,        // pätkän häivytys, ajastetaan uusiksi jos aikaa pidennetään
    master: null,      // pysyvä äänenvoimakkuus, elää kontekstin mukana
    revive: false,     // sivu kävi taustalla: konteksti rakennetaan uusiksi
    startedAt: 0,      // ctx.currentTime pätkän alkaessa
    total: 0,          // pätkän ajastettu pituus sekunteina
    raf: 0,
    playing: false,
  };

  // ---------- DOM ----------
  const $ = (s) => document.querySelector(s);
  const el = {
    body: document.body,
    views: {
      game: $("#view-game"),
      results: $("#view-results"),
      stats: $("#view-stats"),
      help: $("#view-help"),
      loading: $("#view-loading"),
    },
    scrim: $("#scrim"),
    drawer: $("#drawer"),
    menuBtn: $("#menu-btn"),
    // Oikea kisko ja se mistä sen sisältö on lainassa, ks. siirraKiskoon.
    rail: $("#rail"),
    railBody: $("#rail-body"),
    railPoints: $("#rail-points"),
    aani: $("#aani"),
    aaniArvo: $("#aani-arvo"),
    dsNumbers: $("#ds-numbers"),
    dsWeekBlock: $("#ds-week-block"),
    dsWeek: $("#ds-week"),
    stage: $(".stage"),
    drawerClose: $("#drawer-close"),
    drawerFoot: $("#drawer-foot"),
    drawerStats: $("#drawer-stats"),
    dsStreak: $("#ds-streak"),
    dsStreakLabel: $("#ds-streak-label"),
    dsPlayed: $("#ds-played"),
    dsBest: $("#ds-best"),
    dsHit: $("#ds-hit"),
    dsLongest: $("#ds-longest"),
    navDailyNote: $("#nav-daily-note"),
    freeReset: $("#free-reset"),
    navFreeNote: $("#nav-free-note"),
    bar: document.querySelector(".bar"),
    barTag: $("#bar-tag"),
    loadingText: $("#loading-text"),
    loadingRetry: $("#loading-retry"),
    retryBtn: $("#retry-btn"),
    feedbackLink: $("#feedback-link"),
    suggestLink: $("#suggest-link"),
    modeLabel: $("#mode-label"),
    modeSub: $("#mode-sub"),
    scoreLabel: $("#score-label"),
    playBtn: $("#play-btn"),
    playIcon: $("#play-icon"),
    clipLen: $("#clip-len"),
    stake: $("#stake"),
    ring: $("#ring-fg"),
    tierBar: $("#tierbar"),
    ladder: $("#ladder"),
    hint: $("#hint"),
    form: $("#guess-form"),
    input: $("#guess-input"),
    suggestions: $("#suggestions"),
    actionBtn: $("#action-btn"),
    log: $("#guess-log"),
    reveal: $("#reveal"),
    revealArt: $("#reveal-art"),
    revealVerdict: $("#reveal-verdict"),
    revealTitle: $("#reveal-title"),
    revealArtist: $("#reveal-artist"),
    revealApple: $("#reveal-apple"),
    revealPoints: $("#reveal-points"),
    rate: $("#rate"),
    rateQ: $("#rate-q"),
    rateRow: $("#rate-row"),
    dataConsent: $("#data-consent"),
    replayBtn: $("#replay-btn"),
    nextBtn: $("#next-btn"),
    resultsTitle: $("#results-title"),
    resultsScore: $("#results-score"),
    resultsSub: $("#results-sub"),
    resultsList: $("#results-list"),
    shareBtn: $("#share-btn"),
    sharePreview: $("#share-preview"),
    shareSheet: $("#share-sheet"),
    shareScrim: $("#share-scrim"),
    shareClose: $("#share-close"),
    shareImg: $("#share-img"),
    shareNote: $("#share-note"),
    shareNative: $("#share-native"),
    shareCopyImg: $("#share-copy-img"),
    shareCopyLink: $("#share-copy-link"),
    againBtn: $("#results-again-btn"),
    statGrid: $("#stat-grid"),
    resetBtn: $("#reset-stats-btn"),
    toast: $("#toast"),
  };

  // ---------- Apurit ----------
  const fmt = (n) => Math.round(n).toLocaleString("fi-FI");
  const secNum = (s) => (s < 1 ? s.toFixed(1).replace(".", ",") : String(s));
  const fmtSec = (s) => secNum(s) + " s";
  /* "0,1 sekunnista" – paljastuksen sanamuotoon, jossa "0,1 s" lukisi oudosti. */
  const secWord = (s) => secNum(s) + " sekunnista";
  const pad = (n) => String(n).padStart(2, "0");

  /* Yhteenveto kertoo mitä tapahtui, ei arvostele pelaajaa: "Neljä viidestä
   * tunnistettu", ei "Hyvä korva!". Sarja on aina viisi biisiä, mutta
   * taulukot kattavat pienemmätkin varmuuden vuoksi ja tuntemattomasta
   * koosta pudotaan murtolukuun. */
  const LUKU = ["Nolla", "Yksi", "Kaksi", "Kolme", "Neljä", "Viisi"];
  const KAIKISTA = { 1: "yhdestä", 2: "kahdesta", 3: "kolmesta", 4: "neljästä", 5: "viidestä" };
  function resultSummary(solved, total) {
    if (!solved) return "Ei osumia.";
    if (solved >= total) return LUKU[total] ? `Kaikki ${LUKU[total].toLowerCase()} tunnistettu.` : `Kaikki ${total} tunnistettu.`;
    return LUKU[solved] && KAIKISTA[total]
      ? `${LUKU[solved]} ${KAIKISTA[total]} tunnistettu.`
      : `${solved}/${total} tunnistettu.`;
  }

  /* Päiväys niin kuin sen puhuisi: "keskiviikkona 3.9.". Viikonpäivä on
   * taulukossa eikä toLocaleDateStringissä, koska tarvitaan essiivi
   * ("keskiviikkona") jota selaimen lokaali ei anna. Vuosi jätetään pois:
   * näytettävä päivä on aina kuluva tai eilinen. */
  const VIIKONPAIVA = ["sunnuntaina", "maanantaina", "tiistaina", "keskiviikkona",
                       "torstaina", "perjantaina", "lauantaina"];
  const dateLine = (d) => `${VIIKONPAIVA[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
  /* Avaimesta takaisin paikalliseksi päiväksi. Pelinäkymä näyttää sen päivän,
   * jonka sarja on auki – ei kellon päivää, joka voi vaihtua kesken pelin. */
  const keyToDate = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); };

  /* Nimetön tapahtumalaskuri. Kirjaa vain sen, että jokin tapahtui – ei
   * biisiä, tulosta eikä mitään pelaajasta. Kaksi tapahtumaa riittää siihen
   * mikä on oikeasti kiinnostavaa: montako aloitettua päivän sarjaa pelataan
   * loppuun. Skripti latautuu asynkronisesti ja mainosesto voi estää sen
   * kokonaan, joten kutsu ei saa kaatua sen puuttumiseen. */
  function track(nimi) {
    /* Laskuri ladataan asynkronisesti, ja "päivä aloitettu" tapahtuu heti
     * sivun auettua – mitattuna skripti oli valmis vasta 147 ms kohdalla,
     * jolloin suora kutsu katosi hiljaa. Siksi yritetään uudestaan kunnes
     * skripti on paikalla, ja luovutetaan viiden sekunnin jälkeen: silloin
     * kyseessä on mainosesto, joka on pelaajan oma valinta. */
    let yritys = 0;
    (function yrita() {
      try {
        if (window.goatcounter && window.goatcounter.count) {
          window.goatcounter.count({ path: nimi, title: nimi, event: true });
          return;
        }
      } catch { return; }   // analytiikka ei koskaan riko peliä
      if (++yritys < 20) setTimeout(yrita, 250);
    })();
  }

  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayKey = () => dayKey(new Date());
  const todayPretty = () => new Date().toLocaleDateString("fi-FI");

  function normalize(s) {
    return s
      .toLowerCase()
      .replace(/ä/g, "a").replace(/ö/g, "o").replace(/å/g, "a")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/&/g, " ja ")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  const store = {
    get(key, fallbackValue) {
      try {
        const raw = localStorage.getItem(STORE + key);
        return raw ? JSON.parse(raw) : fallbackValue;
      } catch { return fallbackValue; }
    },
    set(key, value) {
      try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* yksityinen tila tms. */ }
    },
    remove(key) {
      try { localStorage.removeItem(STORE + key); } catch { /* ignore */ }
    },
    keys() {
      try {
        return Object.keys(localStorage).filter((k) => k.startsWith(STORE)).map((k) => k.slice(STORE.length));
      } catch { return []; }
    },
  };

  // Siirtää aiemman nimen alla olevat tulokset kerran, ettei putki ja tilastot katoa.
  function migrateStore() {
    try {
      if (store.keys().length) return;
      Object.keys(localStorage)
        .filter((k) => k.startsWith(STORE_OLD))
        .forEach((k) => localStorage.setItem(STORE + k.slice(STORE_OLD.length), localStorage.getItem(k)));
    } catch { /* ignore */ }
  }

  let toastTimer = 0;
  function toast(msg, ms = 2200) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
  }

  // ---------- Näkymät ----------
  function show(name) {
    state.view = name;
    // Jakoruutu kuuluu tuloksiin. Muualle siirryttäessä se jäisi leijumaan.
    if (el.body.classList.contains("sheet-open")) {
      el.shareSheet.hidden = true;
      el.shareScrim.hidden = true;
      el.body.classList.remove("sheet-open");
    }
    /* Ääni kuuluu vain peliin. openRound pysäyttää soiton kierrosten välillä
     * ja go() valikosta siirryttäessä, mutta viimeisen biisin jälkeen
     * Tulokset-nappi vie tuloksiin kolmatta reittiä, eikä pätkä pysähtynyt:
     * se jäi soimaan tulosnäkymään. Pysäytys näkymän vaihdossa kattaa kaikki
     * reitit kerralla. */
    if (name !== "game") stopPlayback();
    for (const [k, v] of Object.entries(el.views)) v.hidden = k !== name;
    // Elävä väri kuuluu soivalle biisille. Muualla sivu palaa perusväriin,
    // jotta sovelluksella on myös oma pysyvä sävynsä.
    if (name !== "game") delete el.body.dataset.tier;
    window.scrollTo({ top: 0 });
    if (name === "stats") renderStats();
    updateBar();
  }

  function updateBar() {
    el.body.dataset.mode = state.mode;
    /* Kiinteä sivupalkki on näkyvissä koko ajan, joten sen sisältö on
     * pidettävä ajan tasalla ilman avaamista. Kapealla ruudulla riittää
     * päivitys avattaessa, koska suljettua ei näe kukaan. */
    if (LEVEA.matches && state.pool.length) refreshDrawer();
    paivitaKisko();
    if (state.view !== "game" || !state.rounds.length) { el.barTag.textContent = ""; return; }
    const valmis = state.rounds.filter((r) => r.finished).length;
    /* Yläpalkki pysyy paikallaan kun sivu vierii, joten se on ainoa kohta
     * josta pelimuodon näkee koko ajan. Vapaa peli merkitään nimeltä, päivän
     * biisit ei: se on oletus, ja saman sanan toistaminen otsikon vieressä
     * näyttäisi vahingolta. Poikkeus on se joka pitää huomata. */
    if (state.mode === "free") {
      el.barTag.innerHTML = `<b>Vapaa peli</b> · ${valmis}/${state.rounds.length}`;
    } else {
      el.barTag.textContent = `${valmis}/${state.rounds.length} valmis`;
    }
  }

  /* ---------- Sivupalkki ----------
   *
   * Kaksi eri asiaa saman elementin takana. Kapealla ruudulla valikko on
   * napin takana ja liukuu sisällön päälle. Leveällä se on kiinteä osa
   * sivua siinä tilassa joka oli muutenkin tyhjää: aina auki, eikä sitä
   * voi sulkea. Kun mitään ei ole peitetty, sulkeminen ei tekisi muuta
   * kuin veisi valikon pois.
   *
   * Raja on CSS:ssä, ja tämä kysyy siltä samaa rajaa eikä arvaa omaansa. */
  const LEVEA = window.matchMedia("(min-width: 1200px)");

  function paivitaPalkki() {
    if (LEVEA.matches) {
      // Kapean ruudun avaustila ei saa jäädä päälle, jos ikkunaa levennetään.
      el.body.classList.remove("drawer-open");
      if (state.pool.length) refreshDrawer();
    }
    el.menuBtn.setAttribute("aria-expanded", String(el.body.classList.contains("drawer-open")));
    paivitaKisko();
  }

  /* Oikea kisko.
   *
   * Vasemmalla on navigointi ja oma tilanne pitkällä aikavälillä, oikealla
   * käynnissä oleva sarja. Kisko ei ole uusi kopio mistään: tasorivi ja
   * vapaan pelin "Uusi sarja" siirretään sinne samoina elementteinä kuin
   * kapealla ruudulla, jolloin kuuntelijat, tila ja ruudunlukijan käsitys
   * pysyvät yhtenä eikä kahtena.
   *
   * Kisko näkyy vain pelinäkymässä. Tuloksissa ja tilastoissa sarjaa ei ole
   * käynnissä, ja tyhjä kisko olisi pelkkä reunaviiva. */
  function paivitaKisko() {
    const kiskoon = LEVEA.matches && state.view === "game" && state.rounds.length > 0;
    el.rail.hidden = !kiskoon;
    if (kiskoon) {
      if (el.tierBar.parentElement !== el.railBody) el.railBody.append(el.tierBar);
      if (el.freeReset.parentElement !== el.railBody) el.railBody.append(el.freeReset);
    } else {
      // Takaisin omille paikoilleen: tasorivi soittimen yläpuolelle,
      // "Uusi sarja" vapaan pelin alle valikkoon.
      if (el.tierBar.parentElement !== el.stage.parentElement) {
        el.stage.parentElement.insertBefore(el.tierBar, el.stage);
      }
      const vapaa = el.drawer.querySelector('[data-go="free"]');
      if (el.freeReset.parentElement !== vapaa.parentElement) vapaa.after(el.freeReset);
    }
    if (kiskoon) piirraPisteet();
  }

  /* Pisteasteikko kiskon alalaidassa.
   *
   * Soittimen alla oleva mittari kertoo missä kohtaa ollaan, mutta ei sitä
   * mitä seuraava askel maksaa. Ohittamisen hinta pitää olla nähtävissä
   * ennen ohittamista eikä vasta jälkikäteen, joten koko asteikko on
   * näkyvissä ja nykyinen askel korostettu. */
  function piirraPisteet() {
    const askel = cur() ? cur().step : 0;
    const paljastettu = cur() ? cur().finished : false;
    el.railPoints.innerHTML = STEPS.map((sec, i) => {
      const nyt = !paljastettu && i === askel;
      return `<li class="${nyt ? "is-now" : i < askel ? "is-past" : ""}">
        <span>${fmtSec(sec)}</span><b>${fmt(POINTS[i])}</b></li>`;
    }).join("");
  }

  function openDrawer() {
    refreshDrawer();
    el.body.classList.add("drawer-open");
    el.menuBtn.setAttribute("aria-expanded", "true");
    el.drawerClose.focus({ preventScroll: true });
  }

  function closeDrawer() {
    el.body.classList.remove("drawer-open");
    el.menuBtn.setAttribute("aria-expanded", "false");
  }

  /* Onko kesken olevaan sarjaan koskettu: yksikin biisi, jota on ehditty
   * ohittaa tai arvata. Koskematon sarja saa vaihtua ilman kyselyä. */
  const sarjaAloitettu = () => state.view === "game" && state.rounds.some((r) => r.finished || r.step > 0);
  /* Vain vapaa sarja voi oikeasti kadota. Päivän sarja tallennetaan joka
   * toiminnon jälkeen ja palautuu sellaisenaan (persistDaily), joten siitä
   * poistuminen ei hävitä mitään. */
  const freeStarted = () => state.mode === "free" && sarjaAloitettu();

  function refreshDrawer() {
    const done = store.get("daily:" + todayKey(), null);
    el.navDailyNote.textContent = done
      ? `pelattu tänään, ${fmt(done.score)} p`
      : `viisi biisiä, ${dateLine(new Date())}`;
    el.drawerFoot.textContent = `${state.pool.length} arvattavaa biisiä · tulokset tallentuvat vain tähän selaimeen`;
    // "Uusi sarja" koskee vain vapaata peliä, joten se näkyy vasta siellä.
    el.freeReset.hidden = !(state.mode === "free" && state.view === "game");
    el.navFreeNote.textContent = !freeStarted() ? "aloita sarja alusta"
      : state.score ? `nollaa sarja ja ${fmt(state.score)} p`
      : "nollaa aloitettu sarja";
    document.querySelectorAll("[data-go]").forEach((b) => {
      const isMode = b.dataset.go === "daily" || b.dataset.go === "free";
      if (isMode) b.classList.toggle("is-active", state.view === "game" && state.mode === b.dataset.go);
    });
    refreshDrawerStats();
  }

  /* Oma tilanne valikossa. Sama putken laskenta kuin tilastonäkymässä: putki
   * on voimassa vain jos viimeisin päivä on tänään tai eilen, muuten se on
   * katkennut. Lohko piilotetaan kunnes ensimmäinen päivä on pelattu, jottei
   * uudelle pelaajalle näytetä pelkkiä nollia. */
  function refreshDrawerStats() {
    const s = { ...defaultStats(), ...store.get("stats", {}) };
    /* Kaksi lohkoa, kaksi eri lähdettä, siis kaksi eri ehtoa. Luvut tulevat
     * kootuista tilastoista, viikko suoraan päivien omista tuloksista.
     *
     * Aiemmin molemmat riippuivat samasta luvusta, ja se oli väärin:
     * tilastojen nollaus poistaa "stats"-avaimen mutta jättää kuluvan päivän
     * tuloksen paikalleen. Silloin valikossa luki "pelattu tänään, 1 500 p"
     * mutta koko lohko oli piilossa, eli sivupalkin alalaita oli tyhjä
     * vaikka näytettävää oli. */
    const viikko = keraaViikko();
    const onPaivia = viikko.some((d) => d.osui !== null);
    el.dsNumbers.hidden = !s.dailyPlayed;
    el.dsWeekBlock.hidden = !onPaivia;
    el.drawerStats.hidden = !s.dailyPlayed && !onPaivia;
    if (el.drawerStats.hidden) return;
    piirraViikko(viikko);
    if (!s.dailyPlayed) return;
    const eilen = new Date(); eilen.setDate(eilen.getDate() - 1);
    const tanaan = s.lastDaily === todayKey();
    const putki = (tanaan || s.lastDaily === dayKey(eilen)) ? s.streak : 0;
    el.dsStreak.textContent = putki;
    el.dsStreakLabel.textContent = putki === 0 ? "putki katkesi"
      : tanaan ? "päivän putki"
      : "putki, et vielä tänään";
    el.dsPlayed.textContent = fmt(s.dailyPlayed);
    el.dsBest.textContent = fmt(s.dailyBest);
    el.dsHit.textContent = Math.round((s.dailySolved / (s.dailyPlayed * DAILY_COUNT)) * 100) + " %";
    el.dsLongest.textContent = fmt(s.bestStreak);
  }

  /* Viimeiset seitsemän päivää.
   *
   * Putkiluku kertoo että päiviä on peräkkäin muttei sitä miten ne menivät.
   * Tiedot ovat jo selaimessa: joka päivä tallentaa oman tuloksensa. Tämä ei
   * siis kerää mitään uutta vaan näyttää sen mitä on. */
  function keraaViikko() {
    const paivat = [];
    for (let i = 6; i >= 0; i--) {
      const pv = new Date();
      pv.setDate(pv.getDate() - i);
      const avain = dayKey(pv);
      const tulos = store.get("daily:" + avain, null);
      paivat.push({
        avain,
        tanaan: i === 0,
        nimi: ["su", "ma", "ti", "ke", "to", "pe", "la"][pv.getDay()],
        osui: tulos ? tulos.results.filter((r) => r.solved).length : null,
        pisteet: tulos ? tulos.score : null,
      });
    }
    return paivat;
  }

  /* Pylvään korkeus on sinä päivänä tunnistetut biisit, väri tason asteikolta
   * samassa suunnassa kuin muualla: viisi oikein vihreä, nolla punainen.
   * Pelaamaton päivä on hiusviiva eikä nollan korkuinen pylväs, koska ne ovat
   * eri asioita ja näyttäisivät muuten samalta. */
  function piirraViikko(paivat) {
    el.dsWeek.innerHTML = paivat.map((d) => {
      const otsikko = d.osui === null
        ? `${d.avain}: ei pelattu`
        : `${d.avain}: ${d.osui}/${DAILY_COUNT} tunnistettu, ${fmt(d.pisteet)} p`;
      const korkeus = d.osui === null ? 0 : 8 + (d.osui / DAILY_COUNT) * 32;
      const taso = Math.max(1, Math.min(5, 5 - d.osui));
      return `<li class="${d.osui === null ? "on-tyhja" : ""}${d.tanaan ? " on-tanaan" : ""}"
        title="${otsikko}"><span style="height:${korkeus}px"
        ${d.osui === null ? "" : `data-tier="${taso}"`}></span><b>${d.nimi}</b></li>`;
    }).join("");
  }

  // ---------- Katalogi ----------
  async function loadCatalog() {
    const res = await fetch(KATALOGI);
    if (!res.ok) throw new Error("songs.json ei latautunut (" + res.status + ")");
    const all = await res.json();
    state.songs = all.filter((s) => s.preview && s.id);
    /* Osa biiseistä on mukana vain hakulistan täytteenä: ne eivät koskaan
     * tule arvattavaksi, mutta tekevät ehdotuslistasta niin tiheän, ettei
     * oikeaa vastausta voi päätellä pelkästään siitä mitä listalla on. */
    state.pool = state.songs.filter((s) => s.peli !== false);
    /* Pakat johdetaan poolista, joten uudelleenlataus (Yritä uudelleen)
     * mitätöi ne. Ilman tyhjennystä jäisi käyttöön vanhan katalogin pakka. */
    tierLists.clear();
    deckCache.clear();
    state.songs.forEach((s) => {
      s.label = `${s.artist} – ${s.title}`;
      s.key = normalize(s.artist + " " + s.title);
      s.keyTitle = normalize(s.title);
      s.keyArtist = normalize(s.artist);
      state.byId.set(String(s.id), s);
    });
    if (state.pool.length < DAILY_COUNT) throw new Error("Katalogissa on liian vähän biisejä.");
  }

  /* Päivän biisejä ei arvota päivä kerrallaan vaan pakka sekoitetaan kerran:
   * jokainen taso saa oman satunnaisen järjestyksen, jota käydään läpi päivä
   * kerrallaan. Riippumattomassa arvonnassa mikään ei estänyt samaa biisiä
   * osumasta peräkkäisinä päivinä – 35 biisin Mahdoton toistui kahden viikon
   * sisällä 95 %:n todennäköisyydellä. Nyt biisi palaa vasta kun koko taso on
   * käyty läpi, eli aikaisintaan tason biisimäärän verran päiviä myöhemmin.
   * Järjestys on yhä pelkkä päivämäärän funktio, joten sarja on sama kaikilla
   * ilman palvelinta. */
  const DAY_MS = 86400000;
  /* Kierron alkupäivä. Tästä päivästä lähtien jaetaan pakkojen ensimmäinen
   * kortti, eli EPOCH:n siirtäminen aloittaa koko kierron alusta. */
  const EPOCH = Date.UTC(2026, 8, 3);   // 3.9.2026
  /* Sekoituksen sukupolvi. Kulkee jokaisen pakan siemeneen, joten numeron
   * nostaminen antaa kaikille tasoille kokonaan uuden järjestyksen ilman
   * että kierron alkupäivää tarvitsee koskea. */
  const SEKOITUS = 5;

  function dayIndex(key) {
    const [y, m, d] = key.split("-").map(Number);
    return Math.floor((Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS);
  }

  // Fisher–Yates siemenellä: sama kierros tuottaa aina saman järjestyksen.
  function shuffled(list, seed) {
    const rnd = mulberry32(seed);
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /* Kierrosten sauma on ainoa kohta, jossa lyhyt toisto vielä mahtuisi
   * syntymään: edellisen pakan loppu ja uuden alku ovat päiviä peräkkäin.
   * Siksi uuden alkupäästä siirretään pois kaikki, jotka olivat edellisen
   * loppupäässä. Vaihtopari haetaan pakan keskeltä, ei lopusta, jotta tämän
   * kierroksen häntä pysyy samana kuin sekoitus antoi – muuten seuraava sauma
   * vertaisi väärään järjestykseen. */
  const GAP = 7;

  function tierOrder(list, tier, cycle) {
    const order = shuffled(list, hashString(`hittispotti:${SEKOITUS}:${tier}:${cycle}`));
    const n = order.length;
    if (cycle <= 0 || n < 2 * GAP + 2) return order;
    const prev = shuffled(list, hashString(`hittispotti:${SEKOITUS}:${tier}:${cycle - 1}`));
    const tail = new Set(prev.slice(n - GAP).map((x) => x.id));
    for (let i = 0; i < GAP; i++) {
      if (!tail.has(order[i].id)) continue;
      for (let j = GAP; j < n - GAP; j++) {
        if (!tail.has(order[j].id)) { [order[i], order[j]] = [order[j], order[i]]; break; }
      }
    }
    return order;
  }

  /* Tason biisit vakaassa lähtöjärjestyksessä, ettei songs.json:in
   * rivijärjestys vaikuta. Välimuistissa, koska sekä pakkojen rakentaminen
   * että törmäysten korjaus tarvitsevat tätä toistuvasti. */
  const tierLists = new Map();
  function tierList(tier) {
    if (!tierLists.has(tier)) {
      tierLists.set(tier, state.pool.filter((s) => s.tier === tier).sort((a, b) => a.id - b.id));
    }
    return tierLists.get(tier);
  }

  // "Juice Leskinen & Grand Slam" ja "Juice Leskinen" ovat sama artisti.
  const artistKey = (song) => normalize(String(song.artist).split(/\s*[,&]\s*|\s+ja\s+/)[0]);

  /* Pakka, josta saman päivän artistitörmäykset on korjattu.
   *
   * Korjaus on VAIHTO pakan sisällä, ei siirtymä eteenpäin. Siirtymä olisi
   * ilmeisempi, mutta se jakaisi väistetyn biisin kahdesti – kerran nyt ja
   * kerran omalla vuorollaan – ja yhden askeleen väistö toisi saman biisin
   * kahtena peräkkäisenä päivänä. Mitattuna lyhin väli toistoon romahti
   * kahdeksasta päivästä yhteen. Vaihdossa syrjäytetty biisi siirtyy sen
   * toisen vuorolle, joten jokainen jaetaan yhä täsmälleen kerran
   * kierroksessa.
   *
   * Tasoilla on kiinteä arvojärjestys: taso 1 ei koskaan väisty, taso 2
   * väistää tasoa 1, taso 3 tasoja 1-2 ja niin edelleen. Riippuvuus kulkee
   * siis aina alaspäin eikä kierrä kehää. */
  const deckCache = new Map();

  function deck(tier, cycle) {
    const avain = tier + ":" + cycle;
    const valmis = deckCache.get(avain);
    if (valmis) return valmis;
    const order = tierOrder(tierList(tier), tier, cycle).slice();
    deckCache.set(avain, order);
    if (tier === TIER_CYCLE[0]) return order;   // ylin taso ei väisty
    const n = order.length;
    /* Vaihtopari haetaan pakan ympäri kiertäen, ei vain eteenpäin: pakan
     * viimeisellä paikalla eteenpäin ei ole mistä vaihtaa, ja mittauksessa
     * juuri sinne jäi yksi törmäys 800 päivästä. Taaksepäin vaihtaminen voi
     * tuoda törmäyksen aiemmalle paikalle, joten kierroksia ajetaan kunnes
     * mikään ei enää muutu – käytännössä yksi tai kaksi riittää. */
    for (let kierros = 0; kierros < 3; kierros++) {
      let muutoksia = 0;
      for (let pos = 0; pos < n; pos++) {
        const day = cycle * n + pos;
        const varatut = new Set();
        for (const alempi of TIER_CYCLE) {
          if (alempi === tier) break;
          const song = dealt(alempi, day);
          if (song) varatut.add(artistKey(song));
        }
        if (!varatut.has(artistKey(order[pos]))) continue;
        for (let askel = 1; askel < n; askel++) {
          const j = (pos + askel) % n;
          if (varatut.has(artistKey(order[j]))) continue;
          [order[pos], order[j]] = [order[j], order[pos]];
          muutoksia++;
          break;
        }
      }
      if (!muutoksia) break;
    }
    return order;
  }

  function dealt(tier, day) {
    const n = tierList(tier).length;
    if (!n) return null;
    return deck(tier, Math.floor(day / n))[((day % n) + n) % n];
  }

  function dailySongs(key) {
    const day = dayIndex(key);
    const picked = [];
    for (const tier of TIER_CYCLE) {
      const song = dealt(tier, day);
      if (song) picked.push(song);
    }
    // Jos jokin taso olisi tyhjä, täytetään viisikko muilta tasoilta.
    const ids = new Set(picked.map((s) => s.id));
    const rnd = mulberry32(hashString("hittispotti:fill:" + key));
    while (picked.length < DAILY_COUNT) {
      const pool = state.pool.filter((s) => !ids.has(s.id));
      if (!pool.length) break;
      const song = pool[Math.floor(rnd() * pool.length)];
      picked.push(song);
      ids.add(song.id);
    }
    return picked;
  }

  // ---------- Ääni ----------
  /* Äänikontekstin herätys.
   *
   * Aiemmin herätys tehtiin vain tilassa "suspended". iOS:n Safarissa on oma
   * tila "interrupted", johon konteksti siirtyy kun puhelu, herätys, toisen
   * sovelluksen ääni tai näytön lukitus keskeyttää sen. Silloin ehto ei
   * täsmännyt, ääntä ei herätetty, eikä loppupelissä kuulunut enää mitään:
   * testaajan sanoin "ääni toimi puolet pelistä". Nyt herätetään aina kun
   * tila ei ole "running", eli myös tuntemattomista tiloista. */
  /* Äänenvoimakkuus.
   *
   * Pätkän oma vahvistin hoitaa häivytyksen ja syntyy uudestaan joka
   * pätkälle, joten se ei voi kantaa asetusta. Sen ja kaiuttimen väliin
   * tulee pysyvä pääsäädin, joka elää äänikontekstin mukana.
   *
   * Puhelimessa on laitteen omat näppäimet, koneella ei mitään: siellä ainoa
   * keino on käyttöjärjestelmän mikseri. Siksi säädin on työpöydän kiskossa,
   * ja siksi arvo muistetaan selaimessa. */
  const AANI_OLETUS = 0.7;
  const aaniTaso = () => {
    const v = Number(store.get("aani", AANI_OLETUS));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : AANI_OLETUS;
  };

  /* iPhonen äänettömyyskytkin.
   *
   * Safari antaa Web Audiolle oletuksena ääni-istunnon tyypin "ambient", ja
   * ambient vaimennetaan aina kun puhelin on äänettömällä. Sama kytkin, joka
   * vaimentaa soittoäänen, vaimensi siis koko pelin, eikä pelaaja saanut
   * siitä mitään ilmoitusta: peli vain oli hiljaa. Tavallinen <audio>-elementti
   * saa eri tyypin ja soi äänettömälläkin, mutta peli ei voi käyttää sitä,
   * koska pätkän pitää katketa 0,1 sekunnin tarkkuudella ja häipyä pehmeästi.
   *
   * "playback" tarkoittaa varsinaista mediatoistoa, jota kytkin ei koske.
   * Hinta on se, ettei ääni enää sekoitu muiden sovellusten kanssa: pätkän
   * soidessa pelaajan oma musiikki pysähtyy eikä käynnisty itsestään takaisin.
   * Musiikkivisassa se on oikea vaihtokauppa, koska biisiä ei kuitenkaan voi
   * arvata oman musiikin päältä.
   *
   * WebKit sulki asiaa koskevan vikailmoituksen (bugs.webkit.org 237322)
   * merkinnällä "configuration changed": sivun kuuluu itse kertoa millaista
   * ääntä se tuottaa. Toimii iOS 17:stä lähtien; muissa selaimissa
   * ominaisuutta ei ole, jolloin tarkistus ohittaa tämän. */
  function asetaAaniIstunto() {
    try {
      if ("audioSession" in navigator) navigator.audioSession.type = "playback";
    } catch { /* Vain ääni jää äänettömällä kuulumatta, peli toimii silti. */ }
  }

  function ensureAudio() {
    if (!audio.ctx) {
      /* Ennen kontekstin luontia: tyyppi ratkaisee millaisena istunto
       * avataan. Kutsutaan joka kerta, koska konteksti voidaan rakentaa
       * uudestaan keskeytyksen jälkeen (ks. reviveAudio). */
      asetaAaniIstunto();
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audio.ctx = new Ctx();
    }
    if (!audio.master || audio.master.context !== audio.ctx) {
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = aaniTaso();
      audio.master.connect(audio.ctx.destination);
    }
    if (audio.ctx.state !== "running") audio.ctx.resume().catch(() => {});
    return audio.ctx;
  }

  function asetaAani(arvo) {
    store.set("aani", arvo);
    if (audio.master) {
      /* Liu'utetaan lyhyesti eikä hypätä: arvon vaihtaminen kesken soivan
       * pätkän naksahtaisi. */
      const g = audio.master.gain;
      g.cancelScheduledValues(audio.ctx.currentTime);
      g.setTargetAtTime(arvo, audio.ctx.currentTime, 0.015);
    }
    if (fallback.el) fallback.el.volume = arvo;
    if (el.aaniArvo) el.aaniArvo.textContent = Math.round(arvo * 100) + " %";
  }

  /* Herätys on lupaus, eikä sitä ennen kannata ajastaa mitään: pysähtyneessä
   * kontekstissa currentTime ei etene, jolloin pätkä ei kuuluisi eikä sen
   * pysäytys laukeaisi. */
  async function wakeAudio(ctx) {
    if (ctx.state === "running") return;
    try { await ctx.resume(); } catch { /* selain voi kieltäytyä ilman elettä */ }
  }

  /* iOS keskeyttää äänikontekstin kun käyttäjä poistuu toiseen sovellukseen.
   * Pelkkä resume() ei riitä: se voi onnistua näennäisesti niin että tila on
   * "running" mutta ääntä ei silti kuulu, eikä herätys ole luotettava ilman
   * käyttäjän elettä. Siksi konteksti rakennetaan uusiksi ensimmäisellä
   * painalluksella sivulle palaamisen jälkeen.
   *
   * Tehdään synkronisesti painalluksen sisällä, koska iOS sallii uuden
   * kontekstin käynnistämisen vain eleen yhteydessä. Vanhan sulkemista ei
   * odoteta. Puretut äänipuskurit eivät ole sidottuja kontekstiin, joten ne
   * säilyvät välimuistissa eikä pätkiä tarvitse ladata uudestaan. */
  function reviveAudio() {
    if (!audio.revive) return;
    audio.revive = false;
    const vanha = audio.ctx;
    audio.ctx = null;
    audio.source = null;
    audio.gain = null;
    audio.master = null;   // kuuluu vanhaan kontekstiin, ensureAudio tekee uuden
    if (vanha) { try { vanha.close(); } catch { /* ignore */ } }
    ensureAudio();
  }

  async function refreshPreviewUrl(song) {
    // Applen esikuuntelu-URL voi vanhentua: haetaan tuore trackId:llä.
    const res = await fetch(`https://itunes.apple.com/lookup?id=${song.id}&country=fi`);
    if (!res.ok) throw new Error("lookup " + res.status);
    const data = await res.json();
    const hit = (data.results || []).find((r) => r.previewUrl);
    if (!hit) throw new Error("ei esikuuntelua");
    song.preview = hit.previewUrl;
    if (hit.artworkUrl100) song.art = hit.artworkUrl100.replace("100x100", "300x300");
    return song.preview;
  }

  class DecodeError extends Error {}

  async function fetchBuffer(song) {
    if (audio.buffers.has(song.id)) return audio.buffers.get(song.id);
    const ctx = ensureAudio();
    const tryUrl = async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("preview " + res.status);
      const bytes = await res.arrayBuffer();
      try {
        return await ctx.decodeAudioData(bytes);
      } catch (err) {
        // Selain lataa tiedoston mutta ei pura AAC:tä Web Audiolla -> <audio>-elementti.
        throw new DecodeError(String((err && err.message) || err));
      }
    };
    let buffer;
    try {
      buffer = await tryUrl(song.preview);
    } catch (err) {
      if (err instanceof DecodeError) throw err;
      buffer = await tryUrl(await refreshPreviewUrl(song));
    }
    audio.buffers.set(song.id, buffer);
    return buffer;
  }

  // Varasoitin, jos Web Audio ei pysty purkamaan esikuuntelua.
  const fallback = { el: null, timer: 0, songId: null };

  function fallbackElement() {
    if (!fallback.el) {
      fallback.el = new Audio();
      fallback.el.preload = "auto";
      fallback.el.crossOrigin = "anonymous";
      fallback.el.volume = aaniTaso();
    }
    return fallback.el;
  }

  function stopFallback() {
    clearTimeout(fallback.timer);
    if (fallback.el && !fallback.el.paused) fallback.el.pause();
  }

  function playClipFallback(song, seconds) {
    return new Promise((resolve, reject) => {
      const a = fallbackElement();
      const begin = () => {
        a.currentTime = 0;
        a.play().then(() => {
          fallback.timer = setTimeout(() => { a.pause(); }, seconds * 1000);
          resolve();
        }).catch(reject);
      };
      if (fallback.songId === song.id && a.readyState >= 2) { begin(); return; }
      fallback.songId = song.id;
      a.src = song.preview;
      a.addEventListener("loadedmetadata", begin, { once: true });
      a.addEventListener("error", () => reject(new Error("audio element error")), { once: true });
      a.load();
    });
  }

  /* Pätkä alkaa esikuuntelun alusta, mutta hiljaisuus ohitetaan: etsitään
   * ensimmäinen kohta, jossa ääntä oikeasti kuuluu. Ilman tätä 0,1 sekunnin
   * pätkä voisi osua kokonaan hiljaiseen alkuun. */
  function findAudioStart(buffer) {
    const data = buffer.getChannelData(0);
    const sr = buffer.sampleRate;
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
    if (peak < 0.005) return 0; // käytännössä äänetön pätkä
    const threshold = Math.max(peak * 0.02, 0.004); // kynnys suhteessa huippuun
    const win = Math.max(1, Math.round(sr * 0.01)); // 10 ms ikkuna
    for (let i = 0; i + win <= data.length; i += win) {
      let sum = 0;
      for (let j = i; j < i + win; j++) sum += data[j] * data[j];
      if (Math.sqrt(sum / win) >= threshold) return Math.max(0, i / sr - 0.03);
    }
    return 0;
  }

  function clipOffset(song, buffer) {
    if (!buffer) return 0; // varasoitin ei pysty analysoimaan näytteitä
    if (!audio.starts.has(song.id)) audio.starts.set(song.id, findAudioStart(buffer));
    return audio.starts.get(song.id);
  }

  /* Soittimen kuvake piirretään muodoilla, ei merkeillä: ▶ ja ■ ovat
   * fontin armoilla eivätkä istu keskelle, ja latauksesta saa kunnon
   * kehän pisteiden sijaan. */
  function setPlayIcon(kind) {
    el.playIcon.className = "play-icon is-" + kind;
    /* Paljastuksessa iso soitin on piilossa, joten Kuuntele-nappi on ainoa
     * äänen hallinta. Sen tekstin pitää kertoa mitä painallus tekee. */
    if (el.replayBtn) el.replayBtn.textContent = kind === "stop" ? "Pysäytä" : "Kuuntele";
  }

  function stopPlayback() {
    if (audio.source) {
      try { audio.source.stop(); } catch { /* jo pysäytetty */ }
      audio.source.disconnect();
      audio.source = null;
    }
    stopFallback();
    cancelAnimationFrame(audio.raf);
    audio.gain = null;
    audio.startedAt = 0;
    audio.total = 0;
    audio.playing = false;
    el.playBtn.classList.remove("is-playing");
    setPlayIcon("play");
    el.ring.style.strokeDashoffset = RING;
  }

  function animateBar(seconds, kulunut = 0) {
    const visual = Math.max(seconds, 0.45); // 0,1 s näkyy silti palkissa
    const start = performance.now() - kulunut * 1000;
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / (visual * 1000));
      el.ring.style.strokeDashoffset = RING * (1 - t);
      if (t < 1) audio.raf = requestAnimationFrame(tick);
      else stopPlayback();
    };
    audio.raf = requestAnimationFrame(tick);
  }

  async function playClip(seconds) {
    const song = state.rounds.length ? cur().song : null;
    if (!song) return;
    stopPlayback();
    reviveAudio();
    el.playBtn.disabled = true;
    setPlayIcon("load");

    const ready = () => {
      el.playBtn.disabled = false;
      audio.playing = true;
      el.playBtn.classList.add("is-playing");
      setPlayIcon("stop");
    };
    const failed = (err) => {
      console.error(err);
      el.playBtn.disabled = false;
      setPlayIcon("play");
      el.hint.textContent = "Pätkän lataus epäonnistui. Tarkista verkkoyhteys tai ohita biisi.";
      toast("Esikuuntelua ei saatu ladattua.");
    };

    let buffer = null;
    try {
      buffer = await fetchBuffer(song);
    } catch (err) {
      if (!(err instanceof DecodeError)) { failed(err); return; }
      if (cur().song !== song) return;
      try {
        await playClipFallback(song, seconds);
      } catch (err2) { failed(err2); return; }
      if (cur().song !== song) { stopFallback(); return; }
      ready();
      animateBar(seconds);
      return;
    }
    if (cur().song !== song) return; // biisi ehti vaihtua

    const ctx = ensureAudio();
    await wakeAudio(ctx);
    if (cur().song !== song) return;   // biisi ehti vaihtua odotuksen aikana
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    // Pieni häivytys, ettei 0,1 s pätkä naksahda.
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const fade = Math.min(0.02, seconds / 4);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fade);
    gain.gain.setValueAtTime(1, now + seconds - fade);
    gain.gain.linearRampToValueAtTime(0, now + seconds);
    src.connect(gain).connect(audio.master || ctx.destination);
    /* Kesto ajastetaan stop():lla eikä start():n kolmantena parametrina:
     * kestoparametri lyö lopetushetken lukkoon eikä myöhempi stop() voi
     * siirtää sitä, jolloin ajan pidentäminen kesken soiton ei onnistuisi. */
    src.start(now, clipOffset(song, buffer));
    src.stop(now + seconds);
    audio.source = src;
    audio.gain = gain;
    audio.startedAt = now;
    audio.total = seconds;
    ready();
    animateBar(seconds);
  }

  /* Ajan pidentäminen kesken soiton ei katkaise ääntä: pätkä jatkaa siitä
   * mihin se ehti ja pysähtyy vasta uuden mitan täytyttyä. Jos ääni ei soi,
   * uusi pätkä alkaa alusta niin kuin ennenkin.
   *
   * Koskee vain arvausvaiheen pidennystä. Luovutuksen jälkeinen paljastus
   * soittaa pisimmän pätkän alusta, koska siinä halutaan kuulla biisi
   * kokonaan eikä jatkaa keskeltä. */
  function extendClip(seconds) {
    if (!audio.playing) { playClip(seconds); return; }
    // Varasoitin: pysäytysajastin uusiksi jäljellä olevalle ajalle.
    if (!audio.source) {
      const a = fallback.el;
      if (!a) { playClip(seconds); return; }
      clearTimeout(fallback.timer);
      const jaljella = Math.max(0, seconds - a.currentTime);
      fallback.timer = setTimeout(() => a.pause(), jaljella * 1000);
      animateBar(seconds, a.currentTime);
      return;
    }
    const ctx = audio.ctx;
    const nyt = ctx.currentTime;
    const kulunut = nyt - audio.startedAt;
    if (kulunut >= seconds) { playClip(seconds); return; }   // ehti jo ohi
    const loppu = audio.startedAt + seconds;
    try { audio.source.stop(loppu); } catch { playClip(seconds); return; }
    // Häivytys oli ajastettu vanhalle lopulle, joten se ajastetaan uusiksi.
    const g = audio.gain && audio.gain.gain;
    if (g) {
      const fade = Math.min(0.02, seconds / 4);
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(nyt);
      else { g.cancelScheduledValues(nyt); g.setValueAtTime(1, nyt); }
      g.setValueAtTime(1, Math.max(nyt, loppu - fade));
      g.linearRampToValueAtTime(0, loppu);
    }
    audio.total = seconds;
    cancelAnimationFrame(audio.raf);
    animateBar(seconds, kulunut);
  }

  function prefetch(song) {
    if (!song || audio.buffers.has(song.id) || !audio.ctx) return;
    fetchBuffer(song).catch(() => { /* yritetään uudestaan kun soitetaan */ });
  }

  // ---------- Peli ----------
  function startDaily() {
    /* Avain otetaan kerran tässä ja kulkee state.dayKey:ssä loppuun asti.
     * Jos se luettaisiin kellosta uudestaan tallennettaessa, 23.58 aloitettu
     * ja 00.03 päättynyt peli kirjautuisi huomisen päivälle tämän päivän
     * biiseillä. */
    const key = todayKey();
    const done = store.get("daily:" + key, null);
    state.mode = "daily";
    state.dayKey = key;
    if (done) {
      state.results = done.results.map((r) => ({ ...r, song: state.byId.get(String(r.id)) }));
      state.score = done.score;
      renderResults();
      show("results");
      return;
    }
    state.at = 0;
    const jatkuu = restoreDailyProgress(key);
    if (!jatkuu) track("paiva-aloitettu");
    state.rounds = jatkuu || dailySongs(key).map(newRound);
    state.results = [];
    state.score = state.rounds.reduce((sum, r) => sum + r.points, 0);
    // Poikkeustapaus: kaikki palautetut kierrokset ovat valmiita, mutta
    // lopputulos jäi kirjaamatta (selain kaatui juuri viimeisen jälkeen).
    if (state.rounds.every((r) => r.finished)) { collectResults(); saveDaily(); renderResults(); show("results"); return; }
    show("game");
    openRound();
    state.rounds.forEach((r) => prefetch(r.song));
  }

  /* Kesken jäänyt päivän sarja tallennetaan joka toiminnon jälkeen ja
   * palautetaan kun päivä avataan uudestaan. Ilman tätä puhelimen selain,
   * joka pudottaa taustalle jääneen välilehden muistista, aloitti sarjan
   * alusta – ja pelaaja oli jo nähnyt osan vastauksista. Biisit palautetaan
   * tallennetuista tunnisteista eikä arvonnasta uudestaan, koska katalogin
   * päivitys voi vaihtaa päivän biisit; pelaajalle kuuluvat ne jotka hän
   * aloitti. */
  const progressKey = (key) => `daily:${key}:kesken`;

  function persistDaily() {
    if (state.mode !== "daily" || !state.dayKey) return;
    store.set(progressKey(state.dayKey), {
      at: state.at,
      rounds: state.rounds.map((r) => ({
        id: r.song.id, step: r.step, guesses: r.guesses,
        finished: r.finished, solved: r.solved, points: r.points,
      })),
    });
  }

  function restoreDailyProgress(key) {
    const saved = store.get(progressKey(key), null);
    if (!saved || !Array.isArray(saved.rounds) || saved.rounds.length !== DAILY_COUNT) return null;
    const rounds = [];
    for (const s of saved.rounds) {
      const song = state.byId.get(String(s.id));
      if (!song) return null;   // biisi poistunut katalogista: aloitetaan puhtaalta
      rounds.push({ ...newRound(song), step: s.step, guesses: s.guesses || [],
                    finished: !!s.finished, solved: !!s.solved, points: s.points || 0 });
    }
    state.at = Number.isInteger(saved.at) ? saved.at : 0;
    return rounds;
  }

  /* Vapaa peli on satunnainen viiden biisin sarja, yksi jokaiselta tasolta:
   * sama rakenne kuin päivän pelissä, mutta sarjoja voi pelata niin monta
   * kuin haluaa. Sarja päättyy tuloksiin ja seuraava alkaa puhtaalta
   * pöydältä, joten pisteet eivät kasaannu loputtomiin. */
  function startFree() {
    /* state.used elää saman sivulatauksen ajan, joten peräkkäisissä sarjoissa
     * ei tule samoja biisejä uudestaan. Sivun päivitys nollaa sen: muistia ei
     * talleteta, koska satunnaisuus riittää eikä toistoa käytännössä ehdi
     * huomata yhden istunnon aikana. */
    state.mode = "free";
    state.results = [];
    state.score = 0;
    state.rounds = TIER_CYCLE.map((t) => newRound(pickFreeSong(t)));
    state.at = 0;
    show("game");
    openRound();
    state.rounds.forEach((r) => prefetch(r.song));
  }

  function pickFreeSong(tier) {
    let pool = state.pool.filter((s) => s.tier === tier && !state.used.has(s.id));
    if (!pool.length) {
      // Taso käyty läpi: aloitetaan se alusta muita tasoja nollaamatta.
      state.pool.forEach((s) => { if (s.tier === tier) state.used.delete(s.id); });
      pool = state.pool.filter((s) => s.tier === tier);
    }
    const song = pool[Math.floor(Math.random() * pool.length)];
    state.used.add(song.id);
    return song;
  }

  /* Jokaisella biisillä on oma tilansa, joten päivän pelissä voi siirtyä
   * toiseen biisiin ja palata kesken jääneeseen ilman että edistyminen
   * katoaa. */
  function newRound(song) {
    return { song, step: 0, guesses: [], finished: false, solved: false, points: 0 };
  }

  const cur = () => state.rounds[state.at];

  function openRound() {
    stopPlayback();
    // Edellisen biisin arvio on nyt lopullinen: pelaaja siirtyi eteenpäin.
    lahetaArvio();
    const r = cur();
    state.selected = null;
    el.input.value = "";
    closeSuggestions();
    el.log.innerHTML = "";
    r.guesses.forEach((g) => logGuess(g.type, g.label));
    if (r.finished) {
      showReveal(r);
    } else {
      el.reveal.hidden = true;
      el.form.hidden = false;
      el.hint.textContent = "";
      el.views.game.classList.remove("is-revealed");
    }
    renderRound();
  }

  function renderRound() {
    const r = cur();
    /* Pelimuoto on näkymän otsikko, ei kuvateksti. Aiemmin ainoa ero muotojen
     * välillä oli tämä rivi himmeällä pikkutekstillä, eikä testaaja huomannut
     * vaihtaneensa muotoa. Nyt nimi on otsikkokokoinen ja päivämäärä jää sen
     * alle pieneksi. Vapaan pelin värin hoitaa CSS body[data-mode]:n kautta. */
    el.modeLabel.textContent = state.mode === "daily" ? "Päivän biisit" : "Vapaa peli";
    el.modeSub.textContent = state.mode === "daily"
      ? dateLine(keyToDate(state.dayKey || todayKey()))
      : "";
    el.scoreLabel.textContent = `${fmt(state.score)} p`;
    // Koko sivun elävä väri on soivan biisin vaikeustaso.
    el.body.dataset.tier = String(r.song.tier);
    renderTierBar();
    const sec = STEPS[r.finished ? STEPS.length - 1 : r.step];
    el.clipLen.innerHTML = `${fmtSec(sec).replace(" s", "")}<span class="unit">s</span>`;
    el.stake.innerHTML = r.finished ? "" : `<b>${fmt(POINTS[r.step])}</b> pistettä pelissä`;
    el.ladder.innerHTML = "";
    STEPS.forEach((sec, i) => {
      const li = document.createElement("li");
      li.className = i < r.step ? "is-done" : i === r.step ? "is-current" : "";
      li.textContent = fmtSec(sec).replace(" s", "");
      li.title = `${fmtSec(sec)} · ${fmt(POINTS[i])} pistettä`;
      el.ladder.appendChild(li);
    });
    renderAction();
    updateBar();
  }

  /* Tasorivi on biisien välinen navigointi kummassakin pelimuodossa: viisikko
   * pysyy paikallaan ja kesken jääneeseen biisiin voi palata myöhemmin. */
  function renderTierBar() {
    el.tierBar.innerHTML = state.rounds.map((r, i) => {
      const name = TIER_NAMES[r.song.tier];
      /* Tila lasketaan aina, myös vuorossa olevalle. Kapealla ruudulla se on
       * vain ruudunlukijan aria-label, koska viisi nimeä mahtuu riville vain
       * ilman lisätekstiä. Leveällä ruudulla kisko näyttää sen myös silmälle:
       * siellä on tilaa, ja silloin sarjan tilanteen näkee vilkaisulla. */
      let cls = "";
      let tila;
      if (r.finished) {
        cls = r.solved ? " is-ok" : " is-miss";
        tila = r.solved ? `tunnistit ${fmtSec(STEPS[r.step])}` : "ei osunut";
      } else if (r.step > 0) {
        cls = " is-part";   // aloitettu mutta kesken: tänne kannattaa palata
        tila = `kesken, ${fmtSec(STEPS[r.step])}`;
      } else {
        tila = "aloittamatta";
      }
      if (i === state.at) cls = " is-on";
      return `<button type="button" class="tchip${cls}" data-slot="${i}" data-tier="${r.song.tier}"
        aria-pressed="${i === state.at}" aria-label="${name}, ${tila}"
        >${name}<span class="tchip-tila">${tila}</span></button>`;
    }).join("");
  }

  /* Yksi nappi riittää: ohitus ja väärä arvaus vievät kierrosta yhtä paljon
   * eteenpäin, joten nappi tekee aina sen mitä kentän sisältö tarkoittaa. */
  /* Soittimen "seuraava raita" -kuvake: ohitus on juuri sitä, joten merkki
   * sanoo saman kuin sana. Piirretty, koska ⏭-merkin ulkoasu ja korkeus
   * vaihtelevat laitteittain. */
  const SKIP_ICON = '<svg class="btn-icon" viewBox="0 0 16 16" aria-hidden="true">'
    + '<path d="M2.6 3.1a.7.7 0 0 1 1.09-.58l6.1 4.32a.8.8 0 0 1 0 1.31l-6.1 4.32A.7.7 0 0 1 2.6 12.9z"/>'
    + '<rect x="11.5" y="2.5" width="2.1" height="11" rx="1.05"/></svg>';

  /* Nappi kertoo teon ja sen hinnan: arvaus näyttää mitä on voitettavana,
   * ohitus sen mihin pätkä pitenee. Luovutuksella ei ole hintaa
   * kerrottavana, joten se on pelkkä sana. */
  function renderAction() {
    const r = cur();
    const ready = !!(state.selected || exactMatch(el.input.value));
    const last = r.step >= STEPS.length - 1;
    const label = ready ? "Arvaa" : last ? "Luovuta" : "Ohita";
    const note = ready ? `+${fmt(POINTS[r.step])} p` : last ? "" : fmtSec(STEPS[r.step + 1]);
    const skip = !ready && !last;
    el.actionBtn.innerHTML = `<span class="btn-label">${label}</span>`
      + (note ? `<span class="btn-note${skip ? " has-icon" : ""}">${skip ? SKIP_ICON : ""}${note}</span>` : "");
    // Kaksi erillistä elementtiä luetaan yhteen ilman väliä, joten nimi erikseen.
    el.actionBtn.setAttribute("aria-label", note ? `${label}, ${note}` : label);
    el.actionBtn.classList.toggle("btn-accent", ready);
    el.actionBtn.classList.toggle("is-give", !ready && last);
  }

  function logGuess(type, label) {
    const li = document.createElement("li");
    li.className = type;
    li.innerHTML = `<span class="mark">${type === "wrong" ? "✕" : "→"}</span><span>${escapeHtml(label)}</span>`;
    el.log.appendChild(li);
  }

  function addGuess(type, label, id) {
    cur().guesses.push({ type, label, id });
    logGuess(type, label);
  }

  /* Onko tämä biisi jo arvattu tällä kierroksella. Väärä arvaus ei kannata
   * toistaa: se veisi askeleen eteenpäin antamatta mitään uutta. */
  const alreadyGuessed = (song) => !!song && cur().guesses.some((g) => g.id === song.id);

  function advanceStep() {
    const r = cur();
    if (r.finished) return;
    if (r.step >= STEPS.length - 1) { finishRound(false); return; }
    r.step += 1;
    persistDaily();
    renderRound();
    el.hint.textContent = "";
    extendClip(STEPS[r.step]);
    el.input.value = "";
    state.selected = null;
    closeSuggestions();
    renderAction();
  }

  function submitGuess() {
    const r = cur();
    if (r.finished) return;
    const guess = state.selected || exactMatch(el.input.value);
    if (!guess) { toast("Valitse biisi listasta."); return; }
    if (guess.id === r.song.id) finishRound(true);
    else { addGuess("wrong", guess.label, guess.id); advanceStep(); }
  }

  function skipStep() {
    const r = cur();
    if (r.finished) return;
    addGuess("skip", r.step >= STEPS.length - 1 ? "Luovutettu" : `Ohitettu ${fmtSec(STEPS[r.step])}`);
    advanceStep();
  }

  function showReveal(r) {
    const song = r.song;
    el.form.hidden = true;
    closeSuggestions();
    el.reveal.hidden = false;
    /* Soitin ja mittari väistyvät paljastuksen tieltä, ks. style.css. */
    el.views.game.classList.add("is-revealed");
    el.reveal.classList.toggle("is-correct", r.solved);
    el.reveal.classList.toggle("is-wrong", !r.solved);
    el.revealArt.hidden = !song.art;
    el.revealArt.src = song.art || "";
    el.revealArt.alt = song.art ? `${song.title} – kansikuva` : "";
    el.revealVerdict.textContent = r.solved
      ? `Oikein · ${secWord(STEPS[r.step])}`
      : "Ei osunut";
    el.revealTitle.textContent = song.title;
    el.revealArtist.textContent = `${song.artist} · ${song.year}`;
    // Sama trackId kuin esikuuntelussa; Apple ohjaa sen kappaleen sivulle.
    el.revealApple.href = `https://music.apple.com/fi/song/${song.id}`;
    el.revealApple.setAttribute("aria-label", `Kuuntele ${song.artist} – ${song.title} Apple Musicissa`);
    el.revealPoints.textContent = r.solved ? `+${fmt(r.points)} pistettä` : "0 pistettä";
    renderRate(song);
    // Viimeisen biisin jälkeen nappi vie tuloksiin kummassakin pelimuodossa.
    el.nextBtn.textContent = state.rounds.some((x) => !x.finished) ? "Seuraava" : "Tulokset";
  }

  function finishRound(solved) {
    stopPlayback();
    const r = cur();
    r.finished = true;
    r.solved = solved;
    r.points = solved ? POINTS[r.step] : 0;
    state.score += r.points;
    logRound(r);
    renderRound();
    showReveal(r);
    /* Biisi lähtee soimaan samalla kun vastaus ilmestyy: pelaaja haluaa
     * kuulla mikä se oli, eikä sitä varten pitäisi tarvita erillistä
     * painallusta. Soitetaan pisin pätkä, jotta biisin tunnistaa.
     *
     * Tämä on tarkoituksella finishRoundissa eikä showRevealissa: showReveal
     * ajetaan myös kun sivu avataan valmiiseen kierrokseen tai kun tasoriviltä
     * palataan jo pelattuun biisiin, eikä ääni saa käynnistyä silloin itsestään.
     * Kierroksen päättyminen taas seuraa aina napin painalluksesta, joten myös
     * iOS sallii äänen. */
    playClip(STEPS[STEPS.length - 1]);
    el.nextBtn.focus({ preventScroll: true });
    if (state.rounds.every((x) => x.finished)) {
      collectResults();
      if (state.mode === "daily") saveDaily();
      else saveFree();
    } else {
      persistDaily();
    }
  }

  function collectResults() {
    state.results = state.rounds.map((x) => ({
      id: x.song.id, song: x.song, step: x.step, points: x.points, solved: x.solved,
    }));
  }

  function nextRound() {
    /* Viimeisen biisin arvio jäi ennen roikkumaan: sarjan lopussa mennään
     * tuloksiin eikä openRoundin kautta, joten mikään ei tyhjentänyt jonoa
     * ennen kuin välilehti suljettiin. Se meni yleensä perille mutta ei aina.
     * Tyhjennys tässä kattaa molemmat haarat kerralla. */
    lahetaArvio();
    // Siirry seuraavaan kesken olevaan biisiin, tarvittaessa alusta kiertäen.
    for (let k = 1; k <= state.rounds.length; k++) {
      const i = (state.at + k) % state.rounds.length;
      if (!state.rounds[i].finished) { state.at = i; persistDaily(); openRound(); return; }
    }
    renderResults();
    show("results");
  }


  // ---------- Ehdotukset ----------

  /* Montako ehdotusta lista näyttää enimmillään. Raja oli kahdeksan, mikä
   * riitti biisin nimellä haettaessa mutta katkaisi artistihaun kesken:
   * "gettomasa" antoi kahdeksan yhdeksästä. Katalogin suurimmilla artisteilla
   * (Eppu Normaali ja PMMP, 20 kappaletta) menee yli kahdenkymmenen vasta jos
   * katalogi kasvaa, joten 25 näyttää nykyisellään jokaisen artistin koko
   * tuotannon. Lista vierii, joten pituus ei vie ruudulta tilaa. */
  const OSUMIA = 25;

  function exactMatch(text) {
    const key = normalize(text);
    if (!key) return null;
    const hit = state.songs.find((s) => s.key === key || normalize(s.label) === key) || null;
    return alreadyGuessed(hit) ? null : hit;
  }

  function findSuggestions(text) {
    const q = normalize(text);
    if (!q) return [];
    const tokens = q.split(" ");
    const scored = [];
    for (const s of state.songs) {
      if (!tokens.every((t) => s.key.includes(t))) continue;
      let score = 0;
      if (s.keyTitle.startsWith(q)) score += 30;
      else if (s.keyArtist.startsWith(q)) score += 25;
      else if (s.key.startsWith(q)) score += 20;
      if (s.keyTitle.includes(q)) score += 10;
      if (s.keyArtist.includes(q)) score += 8;
      score -= s.tier; // tutummat ensin tasapelissä
      scored.push([score, s]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].label.localeCompare(b[1].label, "fi"));
    return scored.slice(0, OSUMIA).map((x) => x[1]);
  }

  function renderSuggestions() {
    el.suggestions.innerHTML = "";
    if (!el.input.value.trim()) { closeSuggestions(); return; }
    if (!state.suggestions.length) {
      el.suggestions.innerHTML = `<li class="empty">Ei osumia – kokeile artistin tai biisin nimeä.</li>`;
    }
    state.suggestions.forEach((s, i) => {
      const used = alreadyGuessed(s);
      const li = document.createElement("li");
      li.className = "suggestion" + (used ? " is-used" : "")
        + (i === state.activeSuggestion && !used ? " is-active" : "");
      li.setAttribute("role", "option");
      li.setAttribute("aria-disabled", String(used));
      li.innerHTML = `<span class="s-title">${escapeHtml(s.title)}</span>`
        + `<span class="s-artist">${escapeHtml(s.artist)}</span>`
        + (used ? '<span class="s-used">arvattu</span>' : "");
      // Kuuntelija myös estetylle riville: napautus, joka ei tee yhtään mitään,
      // näyttää rikkinäiseltä. preventDefault pitää kentän kohdistettuna,
      // jolloin lista ei sulkeudu alta.
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        if (used) toast(`${s.title} on jo arvattu tällä biisillä.`);
        else chooseSuggestion(s);
      });
      el.suggestions.appendChild(li);
    });
    el.suggestions.hidden = false;
    el.input.setAttribute("aria-expanded", "true");
    updateSearchMode();
    scrollActiveIntoView();
  }

  /* Nuolinäppäimillä liikkuminen piirtää listan uusiksi, joten valittu rivi
   * voi jäädä vieritetyn listan ulkopuolelle. Vieritetään vain listaa, ei
   * sivua: scrollIntoView liikuttaisi myös taustalla olevaa näkymää. */
  function scrollActiveIntoView() {
    const rivi = el.suggestions.children[state.activeSuggestion];
    if (!rivi) return;
    const lista = el.suggestions.getBoundingClientRect();
    const r = rivi.getBoundingClientRect();
    if (r.top < lista.top) el.suggestions.scrollTop -= lista.top - r.top;
    else if (r.bottom > lista.bottom) el.suggestions.scrollTop += r.bottom - lista.bottom;
  }

  /* Ehdotuslistan paikka ja korkeus näkyvän alueen mukaan.
   *
   * Puhelimessa näppäimistö peittää alaosan, eikä sivu tiedä siitä mitään:
   * mitattuna 440 px:n näkyvässä alueessa kentän alle jäi 136 px ja listasta
   * näkyi kaksi riviä kahdeksasta. Kentän yläpuolella oli 254 px tyhjää.
   * Siksi lista käännetään ylös kun sinne mahtuu enemmän, ja korkeus
   * rajataan siihen mitä oikeasti on käytettävissä.
   *
   * visualViewport kertoo näppäimistön viemän tilan; ilman sitä (vanhat
   * selaimet, työpöytä) käytetään ikkunan korkeutta, jolloin lista pysyy
   * alhaalla niin kuin ennenkin. */
  function placeSuggestions() {
    if (el.suggestions.hidden) { suunta = null; korkeus = 0; return; }
    const vv = window.visualViewport;
    const nakyvaYla = vv ? vv.offsetTop : 0;
    const alaraja = nakyvaYla + (vv ? vv.height : window.innerHeight);
    /* Yläpalkki on sticky ja piirtyy listan päälle, joten sen alareuna on
     * todellinen yläraja. Ilman tätä ylöspäin auennut lista jäi osittain
     * palkin alle ja ylin ehdotus näkyi puolikkaana. */
    const palkki = el.bar ? el.bar.getBoundingClientRect().bottom : 0;
    const ylaraja = Math.max(nakyvaYla, palkki);
    const r = el.input.getBoundingClientRect();
    const MARGIN = 8, VAHIN = 120, ENINTAAN = 360, KUOLLUT = 12;
    const alla = alaraja - r.bottom - MARGIN;
    const ylla = r.top - ylaraja - MARGIN;
    /* Suunta valitaan kerran listan auetessa ja se pidetään. Sääntö oli
     * aiemmin pelkkä "sinne missä on enemmän tilaa", ja se laskettiin uusiksi
     * joka näppäinpainalluksella. Androidilla näppäimistö pienentää sivun
     * asetteluikkunaa, jolloin tilat muuttuvat kesken kirjoittamisen ja lista
     * loikki kentän ylä- ja alapuolen väliä. Suunta vaihtuu enää vain jos
     * nykyiselle puolelle ei mahdu vähimmäiskorkeutta ja toisella on enemmän. */
    if (suunta === null) suunta = ylla > alla ? "ylos" : "alas";
    else if (suunta === "alas" && alla < VAHIN && ylla > alla) suunta = "ylos";
    else if (suunta === "ylos" && ylla < VAHIN && alla > ylla) suunta = "alas";
    const ylos = suunta === "ylos";
    el.suggestions.classList.toggle("is-up", ylos);
    const tila = Math.floor(ylos ? ylla : alla);
    /* Sama syy: parin pikselin heilahdus näkyvässä alueessa muutti listan
     * korkeutta joka merkillä. Kirjoitetaan vain kun ero on sen verran suuri
     * ettei kyse ole näppäimistön animaation aiheuttamasta värähdyksestä. */
    const uusi = Math.max(VAHIN, Math.min(tila, ENINTAAN));
    if (Math.abs(uusi - korkeus) >= KUOLLUT) {
      korkeus = uusi;
      el.suggestions.style.maxHeight = uusi + "px";
    }
  }

  /* Hakutila: kirjoitettaessa soitin, mittari ja tasorivi väistyvät, jolloin
   * kenttä nousee yläpalkin alle ja ehdotuksille jää koko ruutu näppäimistöön
   * asti. Ks. style.css.
   *
   * Ehto on pelkkä ruudun leveys. Ensin kokeiltiin mitata näppäimistön viemä
   * tila (window.innerHeight - visualViewport.height), koska se olisi ollut
   * tarkin ehto: työpöydällä ja näppäimistöllisellä tabletilla mikään ei peity.
   * iPhonella se ei kuitenkaan mennyt kertaakaan päälle, joten mittaus jäi.
   * Kapealla ruudulla kenttään painaminen avaa näppäimistön joka tapauksessa,
   * eikä väärää tulkintaa käytännössä synny. */
  const kapea = window.matchMedia("(max-width: 720px)");
  /* Listan voimassa oleva suunta ja korkeus. Nollataan kun lista suljetaan. */
  let suunta = null, korkeus = 0;

  function updateSearchMode() {
    /* Hakutila vaatii myös ehdotuksia näkyviin. Pelkkä kentän kohdistus ei
     * riitä: tyhjällä kentällä ruudulle jäi vain kenttä ja Ohita-nappi, eikä
     * takaisin pelinäkymään ollut mitään mihin painaa. Kun tila on sidottu
     * listaan, se avautuu vasta kun tilalle on käyttöä ja sulkeutuu heti kun
     * kenttä tyhjennetään. "Ei osumia" ei kelpaa: silloin ei ole listaa jolle
     * tilaa raivattaisiin. */
    const rivit = !el.suggestions.hidden && state.suggestions.length > 0;
    const kirjoitettu = el.input.value.trim() !== "";
    const oli = el.views.game.classList.contains("is-searching");
    /* Auki mennään vasta kun listalla on rivejä, mutta auki myös pysytään niin
     * kauan kuin kentässä on tekstiä. Aiemmin ehtona olivat pelkät rivit, ja
     * kesken sanan kirjoittaminen osui jatkuvasti tilaan jossa osumia ei ole
     * ("gettomasaa"). Näkymä romahti ja palautui joka merkillä, mikä näkyi
     * Androidilla sivun heittelynä. Tyhjä kenttä sulkee tilan yhä, joten
     * ulospääsy kentän tyhjennysnapista säilyy. */
    const paalla = document.activeElement === el.input && kapea.matches
      && (rivit || (oli && kirjoitettu));
    el.views.game.classList.toggle("is-searching", paalla);
    /* Selain vierittää sivua itse saadakseen kentän näppäimistön yläpuolelle.
     * Kun muu sisältö väistyy, sivu on lyhyt eikä vieritystä enää tarvita,
     * mutta selain ei palauta sitä. Vain tilaan siirryttäessä: Androidilla
     * näppäimistö laukaisee resize-tapahtumia pitkin kirjoittamista, ja
     * jokaisella kerralla vierittäminen kilpaili selaimen oman vierityksen
     * kanssa. Se oli heittelyn pääsyy. */
    if (paalla && !oli && window.scrollY > 0) window.scrollTo(0, 0);
    placeSuggestions();
  }

  function closeSuggestions() {
    el.suggestions.hidden = true;
    el.suggestions.classList.remove("is-up");
    el.suggestions.style.maxHeight = "";
    el.input.setAttribute("aria-expanded", "false");
    state.activeSuggestion = -1;
    state.suggestions = [];
    updateSearchMode();
  }

  function chooseSuggestion(song) {
    if (alreadyGuessed(song)) return;
    state.selected = song;
    el.input.value = song.label;
    closeSuggestions();
    // Valinta on tehty: näppäimistö pois ja soitin takaisin näkyviin, jotta
    // Arvaa-nappi on heti painettavissa.
    el.input.blur();
    renderAction();
    el.actionBtn.focus({ preventScroll: true });
  }

  function onInput() {
    state.selected = null;
    state.suggestions = findSuggestions(el.input.value);
    state.activeSuggestion = state.suggestions.length ? 0 : -1;
    renderAction();
    renderSuggestions();
  }

  function onInputKey(e) {
    if (el.suggestions.hidden) {
      if (e.key === "ArrowDown" && el.input.value.trim()) { onInput(); e.preventDefault(); }
      return;
    }
    const n = state.suggestions.length;
    // Jo arvatut ohitetaan, jottei niihin voi päätyä näppäimistölläkään.
    const move = (dir) => {
      for (let k = 1; k <= n; k++) {
        const i = ((state.activeSuggestion + dir * k) % n + n) % n;
        if (!alreadyGuessed(state.suggestions[i])) return i;
      }
      return -1;
    };
    if (e.key === "ArrowDown") {
      e.preventDefault();
      state.activeSuggestion = n ? move(1) : -1;
      renderSuggestions();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      state.activeSuggestion = n ? move(-1) : -1;
      renderSuggestions();
    } else if (e.key === "Enter") {
      if (state.activeSuggestion >= 0 && state.suggestions[state.activeSuggestion]) {
        e.preventDefault();
        chooseSuggestion(state.suggestions[state.activeSuggestion]);
      }
    } else if (e.key === "Escape") {
      closeSuggestions();
    }
  }

  // ---------- Tulokset ----------
  const squares = (r) => STEPS.map((_, i) => (i < r.step ? "🟥" : i === r.step ? (r.solved ? "🟩" : "🟥") : "⬜")).join("");

  /* Sama tieto sivulla piirrettynä. Emojiruudut kuuluvat jaettavaan
   * tekstiin, mutta muun typografian seassa ne näyttävät liimatuilta. */
  const squaresHtml = (r) => STEPS.map((_, i) => {
    const cls = i < r.step ? "miss" : i === r.step ? (r.solved ? "hit" : "miss") : "none";
    return `<i class="sq is-${cls}"></i>`;
  }).join("");

  function shareText() {
    const lines = [];
    if (state.mode === "daily") {
      lines.push(`🎵 HittiSpotti · ${todayPretty()}`);
      lines.push(`${fmt(state.score)} / ${fmt(POINTS[0] * DAILY_COUNT)} pistettä`);
    } else {
      lines.push("🎵 HittiSpotti · vapaa sarja");
      lines.push(`${fmt(state.score)} / ${fmt(POINTS[0] * state.results.length)} pistettä`);
    }
    lines.push("");
    state.results.forEach((r) => lines.push(`${squares(r)} ${r.solved ? fmt(r.points) : "0"}`));
    if (location.protocol.startsWith("http")) {
      lines.push("");
      lines.push(location.origin + location.pathname);
    }
    return lines.join("\n");
  }

  function renderResults() {
    const daily = state.mode === "daily";
    const solved = state.results.filter((r) => r.solved).length;
    el.resultsTitle.textContent = daily
      ? `Päivän biisit, ${dateLine(keyToDate(state.dayKey || todayKey()))}`
      : "Vapaa peli";
    el.resultsScore.textContent = fmt(state.score);
    const yhteenveto = resultSummary(solved, daily ? DAILY_COUNT : state.results.length);
    el.resultsSub.textContent = daily ? `${yhteenveto} Uusi sarja huomenna.` : yhteenveto;
    el.resultsList.innerHTML = "";
    state.results.forEach((r) => {
      const s = r.song || state.byId.get(String(r.id)) || { title: "?", artist: "?", art: "", year: "" };
      const li = document.createElement("li");
      li.dataset.tier = s.tier ?? "";
      li.innerHTML = `
        <img src="${escapeHtml(s.art || "")}" alt="" loading="lazy">
        <div>
          <div class="r-title">${escapeHtml(s.title)}</div>
          <div class="r-artist">${escapeHtml(s.artist)} · ${escapeHtml(s.year ?? "")}</div>
          <div class="r-meta">
            <span class="r-tier">${escapeHtml(TIER_NAMES[s.tier] || "")}</span>
            <span class="r-squares" aria-hidden="true">${squaresHtml(r)}</span>
          </div>
        </div>
        <div class="r-points${r.solved ? "" : " zero"}">${r.solved ? "+" + fmt(r.points) : "0"}</div>`;
      el.resultsList.appendChild(li);
    });
    piilotaJako();
    valmisteleKuva();
    el.againBtn.textContent = daily ? "Vapaa peli" : "Uusi sarja";
  }

  /* ---------- Tuloskuva ----------
   *
   * Kuvassa EI näy biisien nimiä eikä kansia, vaikka kannet sen sallisivat
   * (Applen kuvapalvelin lähettää access-control-allow-origin: *). Syy on
   * pelillinen: päivän biisit ovat kaikille samat, joten nimet paljastava
   * kuva pilaisi päivän siltä jolle sen lähettää. Juuri se tekisi jakamisesta
   * hyödytöntä. Neliöt kertovat miten meni paljastamatta mitä.
   *
   * Piirretään 1080 x 1080: neliö toistuu viestisovelluksissa ennustettavasti
   * eikä rajaudu esikatselussa. */
  const KUVA = 1080;
  const NAYTA = '"Bricolage Grotesque", system-ui, sans-serif';

  const TIER_VARIT = ["", "#5ecf9a", "#bcd14a", "#f5b32e", "#ff8a4c", "#ff5f6d"];

  /* Päivän biisit ja vapaa peli saavat eri kuvan, ja ero on tarkoituksellinen.
   * Päivän biisit ovat kaikille samat, joten nimet paljastava kuva pilaisi
   * päivän siltä jolle sen lähettää: siellä pelkät neliöt. Vapaan pelin biisit
   * arvotaan jokaiselle erikseen, joten siellä ei ole mitään pilattavaa ja
   * kannet saa näyttää. */
  async function tulosKuva() {
    // Oma fontti pitää olla ladattu ennen piirtoa, muuten canvas käyttää
    // varafonttia eikä kuva näytä sivustolta.
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch { /* varafontilla mennään */ }
    }
    return state.mode === "daily" ? neliokuva() : listakuva(await lataaKannet());
  }

  /* Kannet erikseen CORS-tilassa. Sivulla olevat img-elementit on ladattu
   * ilman sitä, ja tavallisena ladattu kuva saastuttaisi canvasin niin ettei
   * siitä saisi enää blobia. Applen kuvapalvelin lähettää
   * access-control-allow-origin: *, joten tämä toimii.
   *
   * Yksikään kansi ei saa jäädä odottamaan ikuisesti: jos lataus ei valmistu
   * kolmessa sekunnissa, piirretään tilalle tyhjä laatikko. */
  function lataaKannet() {
    return Promise.all(state.results.map((r) => new Promise((valmis) => {
      const s = r.song || state.byId.get(String(r.id));
      if (!s || !s.art) return valmis(null);
      const kuva = new Image();
      kuva.crossOrigin = "anonymous";
      const aika = setTimeout(() => valmis(null), 3000);
      kuva.onload = () => { clearTimeout(aika); valmis(kuva); };
      kuva.onerror = () => { clearTimeout(aika); valmis(null); };
      kuva.src = s.art;
    })));
  }

  function pohja(g, leveys, korkeus) {
    g.fillStyle = "#0a0908";
    g.fillRect(0, 0, leveys, korkeus);
    g.textBaseline = "alphabetic";
  }

  /* Sama viiden palkin aaltomuoto kuin kuvakkeessa ja sanamerkissä. Palkit
   * piirretään paksuina viivoina pyörein päin eikä pyöristettyinä
   * suorakulmioina: roundRect puuttuu vanhemmista Safareista, ja pyöreä
   * viivanpää antaa täsmälleen saman muodon joka selaimessa.
   *
   * Yksiköt ovat samat kuin favicon.svg:ssä: 52 leveä, 46 korkea, palkki 8,
   * väli 3. Mittakaava tulee halutusta korkeudesta. */
  const MERKKI = [19.6, 34.8, 46, 28.4, 39.6];

  function merkki(g, x, alaviiva, korkeus) {
    const k = korkeus / 46;
    g.lineCap = "round";
    g.lineWidth = 8 * k;
    MERKKI.forEach((h, i) => {
      const kx = x + (i * 11 + 4) * k;
      g.strokeStyle = TIER_VARIT[i + 1];
      g.beginPath();
      g.moveTo(kx, alaviiva - 4 * k);
      g.lineTo(kx, alaviiva - (h - 4) * k);
      g.stroke();
    });
  }

  // Sanamerkki, pelimuoto ja pisteluku ovat molemmissa kuvissa samat.
  function otsikko(g, reuna, muoto) {
    let y = reuna + 44;
    merkki(g, reuna, y, 34);
    g.font = `800 52px ${NAYTA}`;
    g.fillStyle = "#f2ebdf";
    const x0 = reuna + 56;
    g.fillText("Hitti", x0, y);
    // Leveys on mitattava lihavalla fontilla, ei vaihdon jälkeen: kevyemmällä
    // mitattuna "Spotti" alkoi liian vasemmalta ja sanat menivät päällekkäin.
    const lev = g.measureText("Hitti").width;
    g.font = `400 52px ${NAYTA}`;
    g.fillText("Spotti", x0 + lev, y);

    y += 62;
    g.font = `400 34px ${NAYTA}`;
    g.fillStyle = "#8a8073";
    g.fillText(muoto, reuna, y);

    y += 176;
    g.font = `800 152px ${NAYTA}`;
    g.fillStyle = "#f2ebdf";
    const pisteet = fmt(state.score);
    g.fillText(pisteet, reuna, y);
    const pl = g.measureText(pisteet).width;
    g.font = `700 44px ${NAYTA}`;
    g.fillStyle = "#8a8073";
    g.fillText("pistettä", reuna + pl + 20, y);
    return y;
  }

  function alaosa(g, reuna, leveys, korkeus, teksti) {
    g.font = `700 38px ${NAYTA}`;
    g.fillStyle = "#8a8073";
    g.fillText(teksti, reuna, korkeus - reuna - 66);
    g.font = `700 40px ${NAYTA}`;
    g.fillStyle = "#5ecf9a";
    g.fillText("hittispotti.fi", reuna, korkeus - reuna);
  }

  function yhteenveto() {
    const s = { ...defaultStats(), ...store.get("stats", {}) };
    const eilen = new Date(); eilen.setDate(eilen.getDate() - 1);
    const putki = (s.lastDaily === todayKey() || s.lastDaily === dayKey(eilen)) ? s.streak : 0;
    const osumat = state.results.filter((r) => r.solved).length;
    const osat = [`${osumat}/${state.results.length} tunnistettu`];
    if (state.mode === "daily" && putki > 1) osat.push(`putki ${putki} päivää`);
    return osat.join("  ·  ");
  }

  // Päivän biisit: neliöt eivät paljasta mitään.
  function neliokuva() {
    const c = document.createElement("canvas");
    c.width = KUVA; c.height = KUVA;
    const g = c.getContext("2d");
    const reuna = 92;
    pohja(g, KUVA, KUVA);
    let y = otsikko(g, reuna, `Päivän biisit · ${dateLine(keyToDate(state.dayKey || todayKey()))}`);

    // Yksi rivi biisiä kohti, viisi ruutua eli viisi pätkän pituutta.
    y += 74;
    const koko = 62, vali = 16;
    state.results.forEach((r) => {
      STEPS.forEach((_, i) => {
        const osuma = i === r.step && r.solved;
        const kaytetty = i < r.step || (i === r.step && !r.solved);
        ruutu(g, reuna + i * (koko + vali), y, koko, osuma ? "#5ecf9a" : kaytetty ? "#3a332c" : null);
      });
      y += koko + vali;
    });
    alaosa(g, reuna, KUVA, KUVA, yhteenveto());
    return c;
  }

  /* Vapaa peli: kannet ja nimet mukaan. Korkeus 1440 eli 3:4. Kokeilin ensin
   * 1350:tä, mutta viidennen biisin vaikeustasorivi osui yhteenvetotekstiin. */
  const KUVA_LISTA = 1440;

  function listakuva(kannet) {
    const c = document.createElement("canvas");
    c.width = KUVA; c.height = KUVA_LISTA;
    const g = c.getContext("2d");
    const reuna = 92;
    pohja(g, KUVA, KUVA_LISTA);
    let y = otsikko(g, reuna, "Vapaa peli");

    y += 46;
    const kansi = 122, rivi = 148, tekstiX = reuna + kansi + 30;
    state.results.forEach((r, i) => {
      const s = r.song || state.byId.get(String(r.id)) || {};
      // Kansi, tai tyhjä laatikko jos sitä ei saatu ladattua.
      if (kannet[i]) g.drawImage(kannet[i], reuna, y, kansi, kansi);
      else { g.fillStyle = "#14120f"; g.fillRect(reuna, y, kansi, kansi); }

      const pisteet = r.solved ? "+" + fmt(r.points) : "0";
      g.font = `700 40px ${NAYTA}`;
      const pLev = g.measureText(pisteet).width;
      g.textAlign = "right";
      g.fillStyle = r.solved ? "#f2ebdf" : "#5b544a";
      g.fillText(pisteet, KUVA - reuna, y + 48);
      g.textAlign = "left";

      const tilaa = KUVA - reuna - tekstiX - pLev - 30;
      g.font = `700 42px ${NAYTA}`;
      g.fillStyle = "#f2ebdf";
      g.fillText(katkaise(g, s.title || "?", tilaa), tekstiX, y + 46);

      g.font = `400 34px ${NAYTA}`;
      g.fillStyle = "#8a8073";
      g.fillText(katkaise(g, `${s.artist || "?"} · ${s.year || ""}`.trim(), tilaa), tekstiX, y + 92);

      // Vaikeustason pallo ja nimi, sama merkintätapa kuin tulosnäkymässä.
      const vari = TIER_VARIT[s.tier] || "#8a8073";
      g.fillStyle = vari;
      g.beginPath(); g.arc(tekstiX + 8, y + 122, 8, 0, Math.PI * 2); g.fill();
      g.font = `400 30px ${NAYTA}`;
      g.fillStyle = "#857c6f";
      g.fillText(TIER_NAMES[s.tier] || "", tekstiX + 28, y + 132);
      y += rivi;
    });
    alaosa(g, reuna, KUVA, KUVA_LISTA, yhteenveto());
    return c;
  }

  // Liian pitkä nimi katkaistaan kolmeen pisteeseen eikä valu kuvan yli.
  function katkaise(g, teksti, tilaa) {
    if (g.measureText(teksti).width <= tilaa) return teksti;
    let t = teksti;
    while (t.length > 1 && g.measureText(t + "…").width > tilaa) t = t.slice(0, -1);
    return t + "…";
  }

  function ruutu(g, x, y, koko, tayte) {
    const r = 8;
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + koko, y, x + koko, y + koko, r);
    g.arcTo(x + koko, y + koko, x, y + koko, r);
    g.arcTo(x, y + koko, x, y, r);
    g.arcTo(x, y, x + koko, y, r);
    g.closePath();
    if (tayte) { g.fillStyle = tayte; g.fill(); }
    else { g.strokeStyle = "#2a2521"; g.lineWidth = 3; g.stroke(); }
  }

  /* Kuva tehdään valmiiksi heti kun tulosnäkymä avataan, ei vasta napista.
   * Näin jakoruutu aukeaa ilman odotusta eikä tyhjä kehys ehdi vilahtaa. */
  let kuvaLupaus = null, kuvaBlob = null;

  function valmisteleKuva() {
    kuvaLupaus = (async () => {
      const c = await tulosKuva();
      return await new Promise((r) => c.toBlob(r, "image/png"));
    })().catch(() => null);
  }

  const jaettavaOsoite = () => (location.protocol.startsWith("http")
    ? location.origin + location.pathname : "https://hittispotti.fi/");

  /* Postilinkit kootaan vasta selaimessa, ei kirjoiteta valmiiksi HTML:ään.
   * Sivun lähdekoodia haravoivat roskapostirobotit eivät aja JavaScriptiä,
   * joten osoite ei päädy niiden listoille aivan yhtä helposti. */
  const POSTI = ["hittispotti", "gmail.com"].join("@");

  /* Laite ja selain lyhyesti. Ensin viestiin liitettiin koko user agent,
   * mutta se vei puhelimen ruudulla viisi riviä ja näytti roskalta juuri
   * siinä kohdassa jossa ihmisen pitäisi kirjoittaa. Vikailmoituksesta
   * tarvitaan käytännössä vain versio ja karkea laite. */
  function laite() {
    const u = navigator.userAgent;
    const alusta = /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad"
      : /Android/.test(u) ? "Android" : /Macintosh/.test(u) ? "Mac"
      : /Windows/.test(u) ? "Windows" : /Linux/.test(u) ? "Linux" : "tuntematon";
    // Järjestyksellä on väliä: Chrome iOS:ssä on CriOS, ja lähes kaikkien
    // selainten tunnisteessa lukee myös Safari.
    const selain = /CriOS|Chrome/.test(u) ? "Chrome" : /FxiOS|Firefox/.test(u) ? "Firefox"
      : /EdgiOS|Edg\//.test(u) ? "Edge" : /Safari/.test(u) ? "Safari" : "tuntematon";
    return `${alusta}, ${selain}`;
  }

  function postilinkki(aihe, runko) {
    return "mailto:" + POSTI + "?subject=" + encodeURIComponent(aihe)
      + "&body=" + encodeURIComponent(runko);
  }

  function asetaPalautelinkki() {
    const skripti = document.querySelector('script[src*="app.js"]');
    const versio = (skripti && (skripti.getAttribute("src").match(/v=(\d+)/) || [])[1]) || "?";
    // Kaksi tyhjää riviä alkuun: kohdistin on siinä missä kirjoittaminen
    // alkaa, eikä käyttäjän tarvitse ensin poistaa mitään.
    if (el.feedbackLink) {
      el.feedbackLink.href = postilinkki("HittiSpotti-palaute",
        `\n\n---\nversio ${versio} · ${laite()}`);
    }
    if (el.suggestLink) {
      el.suggestLink.href = postilinkki("Biisiehdotus",
        "Artisti:\nKappale:\n\nVoit ehdottaa useampaa kerralla.\n");
    }
  }

  async function avaaJako() {
    el.sharePreview.hidden = true;
    if (!kuvaLupaus) valmisteleKuva();
    kuvaBlob = await kuvaLupaus;

    if (kuvaBlob) {
      if (el.shareImg.dataset.url) URL.revokeObjectURL(el.shareImg.dataset.url);
      const url = URL.createObjectURL(kuvaBlob);
      el.shareImg.dataset.url = url;
      el.shareImg.src = url;
      el.shareImg.hidden = false;
      /* Tiedostojako ei ole kaikkialla: työpöytäselaimissa se yleensä
       * puuttuu, ja silloin nappi on turha eikä sitä näytetä. */
      const tiedosto = new File([kuvaBlob], "hittispotti.png", { type: "image/png" });
      el.shareNative.hidden = !(navigator.canShare && navigator.canShare({ files: [tiedosto] }));
      el.shareCopyImg.hidden = !(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write);
      /* Selite kertoo mitä kuvassa on, ja se riippuu pelimuodosta eikä
       * laitteen ominaisuuksista. Nämä menivät aiemmin sekaisin: vapaan pelin
       * kuvan alla luki että kuva ei paljasta biisejä, vaikka se listaa ne. */
      const osat = [state.mode === "daily"
        ? "Kuva ei paljasta biisejä, joten sen voi lähettää kenelle vain."
        : "Kuvassa näkyvät biisit. Vapaassa pelissä ne ovat jokaisella eri."];
      if (el.shareNative.hidden) osat.push("Tallenna painamalla kuvaa pitkään.");
      el.shareNote.textContent = osat.join(" ");
    } else {
      // Kuvaa ei saatu: näytetään tekstiversio, jotta jakaminen onnistuu silti.
      el.shareImg.hidden = true;
      el.shareNative.hidden = true;
      el.shareCopyImg.hidden = true;
      el.shareNote.textContent = "Kuvan luonti ei onnistunut tällä selaimella. Tulos tekstinä:";
      el.sharePreview.textContent = shareText();
      el.sharePreview.hidden = false;
    }

    el.shareScrim.hidden = false;
    el.shareSheet.hidden = false;
    el.body.classList.add("sheet-open");
    el.shareClose.focus({ preventScroll: true });
  }

  function suljeJako() {
    el.shareSheet.hidden = true;
    el.shareScrim.hidden = true;
    el.body.classList.remove("sheet-open");
    el.shareBtn.focus({ preventScroll: true });
  }

  async function jaaKuva() {
    if (!kuvaBlob) return;
    const tiedosto = new File([kuvaBlob], "hittispotti.png", { type: "image/png" });
    try {
      await navigator.share({ files: [tiedosto] });
      suljeJako();
    } catch (e) {
      // Käyttäjän oma peruutus ei ole virhe eikä ansaitse ilmoitusta.
      if (!e || e.name !== "AbortError") toast("Jakaminen ei onnistunut.");
    }
  }

  async function kopioiKuva() {
    if (!kuvaBlob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": kuvaBlob })]);
      toast("Kuva kopioitu leikepöydälle.");
    } catch {
      toast("Kopiointi ei onnistunut. Paina kuvaa pitkään.");
    }
  }

  async function kopioiLinkki() {
    try {
      await navigator.clipboard.writeText(jaettavaOsoite());
      toast("Linkki kopioitu leikepöydälle.");
    } catch {
      toast("Kopiointi ei onnistunut.");
    }
  }

  function piilotaJako() {
    el.sharePreview.hidden = true;
    if (el.shareImg.dataset.url) {
      URL.revokeObjectURL(el.shareImg.dataset.url);
      delete el.shareImg.dataset.url;
      el.shareImg.removeAttribute("src");
    }
    kuvaBlob = null;
    kuvaLupaus = null;
  }

  /* ---------- Kerätty aineisto ----------
   * Kaksi eri asiaa, joista jälkimmäinen on arvokkaampi:
   *   arviot   – pelaajan oma arvio siitä miltä biisi tuntui (vapaaehtoinen)
   *   kierrokset – millä askeleella biisi tunnistettiin, vai luovutettiinko
   * Askel on käyttäytymistä eikä mielipidettä, ja se kertyy joka kierroksesta
   * ilman että pelaajalta kysytään mitään. Molemmat jäävät kokonaisina tähän
   * selaimeen, ja molemmista lähtee tilastopalvelimelle nimetön kooste, jos
   * pelaaja ei ole kytkenyt sitä pois.
   */
  const LOG_MAX = 3000;

  function logRound(r) {
    const log = store.get("kierrokset", []);
    const kierros = {
      id: r.song.id,
      taso: r.song.tier,
      askel: r.step,          // 0-4, eli 0,1 s ... 15 s
      osui: r.solved,
      pv: (state.mode === "daily" && state.dayKey) || todayKey(),
      tila: state.mode,
    };
    log.push(kierros);
    store.set("kierrokset", log.slice(-LOG_MAX));
    lahetaKierros(kierros);
  }

  /* Kierroksen lähetys tilastopalvelimelle.
   *
   * Tämä on ainoa asia jonka peli lähettää itsestään ulos. Mukana menee
   * biisi, taso, askel, osuiko ja pelimuoto. Ei tunnistetta, ei aikaleimaa,
   * ei mitään mikä yhdistäisi kaksi kierrosta samaan pelaajaan: palvelin
   * laskee vain koosteita. Päivämäärä jätetään pois tarkoituksella, koska
   * sitä ei tarvita eikä sitä siksi kuulu lähettää.
   *
   * sendBeacon on tähän oikea työkalu: se ei odota vastausta, ei hidasta
   * peliä, ja menee perille vaikka pelaaja sulkisi välilehden samalla
   * sekunnilla. text/plain pitää pyynnön "yksinkertaisena", jolloin selain
   * ei tee erillistä esikyselyä.
   *
   * Osoite on tyhjä kunnes palvelin on julkaistu; silloin tämä ei tee mitään
   * ja peli toimii täsmälleen kuten ennenkin. */
  const PALVELIN = "";  /* Esikatselu ei lähetä tilastoja. */

  const dataLupa = () => store.get("datalupa", true) !== false;

  function lahetaKierros(k) {
    if (!PALVELIN || !dataLupa()) return;
    const runko = JSON.stringify({
      id: k.id, taso: k.taso, askel: k.askel, osui: k.osui, tila: k.tila,
    });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(PALVELIN + "/kierros", new Blob([runko], { type: "text/plain" }));
        return;
      }
      // Vanhemmat selaimet: keepalive tekee saman kuin sendBeacon.
      fetch(PALVELIN + "/kierros", {
        method: "POST", body: runko, keepalive: true,
        headers: { "content-type": "text/plain" },
      }).catch(() => {});
    } catch { /* tilastointi ei koskaan riko peliä */ }
  }

  /* Arvion lähetys.
   *
   * Arvio on toinen signaali samasta biisistä: askel kertoo mitä pelaaja
   * teki, arvio mitä hän ajatteli. Vertaamalla niitä näkee onko biisi
   * oikeasti vaikea vai tuntuuko se vain siltä.
   *
   * Kaksi eroa kierroksen lähetykseen, molemmat siksi että palvelin osaa
   * vain kasvattaa lukua eikä siirtää sitä sarakkeesta toiseen:
   *
   *   1. Lähetys tapahtuu vasta kun pelaaja siirtyy eteenpäin, ei joka
   *      napautuksesta. Mielensä saa siis muuttaa ilman että palvelin
   *      laskee kolme mielipidettä yhdestä.
   *   2. Kustakin biisistä lähtee vain ensimmäinen arvio. Jälkikäteen
   *      vaihdettu arvio näkyy pelaajalle itselleen mutta jää selaimeen.
   *
   * Kolmas vaihtoehto olisi lähettää vanha ja uusi arvio ja antaa palvelimen
   * vähentää edellinen. Se vaatisi luottamaan siihen mitä selain väittää
   * lähettäneensä aiemmin, ja osoite on julkinen: kuka tahansa voisi
   * vähentää mitä tahansa. Ensimmäinen arvio on huonompi mutta rehellinen.
   */
  let odottavaArvio = null;

  function saveRating(song, tier) {
    const all = store.get("arviot", {});
    all[song.id] = tier;
    store.set("arviot", all);
    // Toisen biisin odottava arvio lähtee ensin, jottei se jää jumiin.
    if (odottavaArvio && odottavaArvio.id !== song.id) lahetaArvio();
    odottavaArvio = { id: song.id, taso: song.tier, arvio: tier };
  }

  function lahetaArvio() {
    const a = odottavaArvio;
    odottavaArvio = null;
    if (!a || !PALVELIN || !dataLupa()) return;
    const lahetetyt = store.get("arviot:lahetetyt", []);
    if (lahetetyt.includes(a.id)) return;
    const runko = JSON.stringify({ id: a.id, taso: a.taso, arvio: a.arvio });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(PALVELIN + "/arvio", new Blob([runko], { type: "text/plain" }));
      } else {
        fetch(PALVELIN + "/arvio", {
          method: "POST", body: runko, keepalive: true,
          headers: { "content-type": "text/plain" },
        }).catch(() => {});
      }
      lahetetyt.push(a.id);
      store.set("arviot:lahetetyt", lahetetyt.slice(-LOG_MAX));
    } catch { /* tilastointi ei koskaan riko peliä */ }
  }

  /* Arviorivi näyttää samalta kuin pelin tasorivi, mutta ei paljasta biisin
   * nykyistä tasoa: valmiiksi valittu vaihtoehto ohjaisi vastausta. */
  function renderRate(song) {
    const given = store.get("arviot", {})[song.id];
    el.rateQ.textContent = given ? `Arviosi: ${TIER_NAMES[given]}` : "Miltä tämä tuntui?";
    el.rateRow.innerHTML = TIER_CYCLE.map((t) => `<button type="button"
      class="tchip${given === t ? " is-on" : ""}" data-rate="${t}" data-tier="${t}"
      aria-pressed="${given === t}">${TIER_NAMES[t]}</button>`).join("");
  }

  // ---------- Tallennus & tilastot ----------
  function defaultStats() {
    return {
      dailyPlayed: 0, dailyTotal: 0, dailyBest: 0, dailySolved: 0, streak: 0, bestStreak: 0, lastDaily: null,
      freeGames: 0, freeRounds: 0, freeSolved: 0, freeTotal: 0, freeBestRun: 0,
    };
  }

  function saveDaily() {
    // Sen päivän avain, jonka sarja pelattiin – ei kellon päivä. Keskiyön yli
    // pelattu sarja kuuluu sille päivälle jolta biisit ovat.
    const key = state.dayKey || todayKey();
    const already = !!store.get("daily:" + key, null);
    store.remove(progressKey(key));
    store.set("daily:" + key, {
      score: state.score,
      results: state.results.map((r) => ({ id: r.id, step: r.step, points: r.points, solved: r.solved })),
    });
    if (already) return;   // sama päivä kirjataan tilastoihin vain kerran
    track("paiva-valmis");
    const stats = { ...defaultStats(), ...store.get("stats", {}) };
    stats.dailyPlayed += 1;
    stats.dailyTotal += state.score;
    stats.dailyBest = Math.max(stats.dailyBest, state.score);
    stats.dailySolved += state.results.filter((r) => r.solved).length;
    // Edellinen päivä lasketaan sarjan omasta päivästä, ei kellosta.
    const y = keyToDate(key); y.setDate(y.getDate() - 1);
    stats.streak = stats.lastDaily === dayKey(y) ? stats.streak + 1 : 1;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    stats.lastDaily = key;
    store.set("stats", stats);
  }

  function saveFree() {
    const stats = { ...defaultStats(), ...store.get("stats", {}) };
    stats.freeGames += 1;
    stats.freeRounds += state.results.length;
    stats.freeSolved += state.results.filter((r) => r.solved).length;
    stats.freeTotal += state.score;
    stats.freeBestRun = Math.max(stats.freeBestRun, state.score);
    store.set("stats", stats);
  }

  function renderStats() {
    const s = { ...defaultStats(), ...store.get("stats", {}) };
    const todayDone = !!store.get("daily:" + todayKey(), null);
    const y = new Date(); y.setDate(y.getDate() - 1);
    const streak = (s.lastDaily === todayKey() || s.lastDaily === dayKey(y)) ? s.streak : 0;
    const tiles = [
      ["head", "Päivän biisit"],
      [s.dailyPlayed, "pelattua päivää"],
      [s.dailyPlayed ? fmt(s.dailyTotal / s.dailyPlayed) : "–", "keskipisteet"],
      [fmt(s.dailyBest), "paras tulos"],
      [s.dailyPlayed ? Math.round((s.dailySolved / (s.dailyPlayed * DAILY_COUNT)) * 100) + " %" : "–", "tunnistettu"],
      // Kaikki muut selitteet ovat kahden sanan mittaisia; tämä oli kolme
      // riviä pitkä ja venytti ruudukon rivin muita korkeammaksi.
      [streak, todayDone ? "päivän putki" : "putki, ei vielä tänään"],
      [s.bestStreak, "pisin putki"],
      ["head", "Vapaa peli"],
      [s.freeGames, "pelattua sarjaa"],
      [s.freeGames ? fmt(s.freeTotal / s.freeGames) : "–", "keskipisteet"],
      [fmt(s.freeBestRun), "paras sarja"],
      [s.freeRounds ? Math.round((s.freeSolved / s.freeRounds) * 100) + " %" : "–", "tunnistettu"],
    ];
    el.statGrid.innerHTML = tiles.map(([v, l]) => (v === "head"
      ? `<p class="stat-head">${l}</p>`
      : `<div class="stat"><div class="stat-value">${v}</div><div class="stat-label">${l}</div></div>`)).join("");
  }

  /* Nollaus koskee tilastoja ja menneiden päivien tuloksia – ei enempää.
   *
   * Aiemmin tämä pyyhki kaikki avaimet, myös kierroslokin ja omat
   * vaikeusarviot, eikä varmistusteksti maininnut niitä lainkaan: nappi
   * hävitti hiljaa kerätyn datan ja lupasi tehdä jotain vaatimattomampaa.
   *
   * Myös tämän päivän tulos jää. Se ei estä uudelleenpelaamista – yksityinen
   * ikkuna tai toinen selain ajaa saman asian, eikä sitä voi selaimessa
   * pyörivässä pelissä estää – mutta poistaa vahingossa tapahtuvan reitin ja
   * tekee napista sen mitä sen nimi lupaa. */
  function resetStats() {
    if (!confirm("Nollataanko tilastot ja aiempien päivien tulokset? Omat arviot ja kerätty pelidata säilyvät.")) return;
    const tanaan = "daily:" + todayKey();
    for (const key of store.keys()) {
      const menneetTulokset = key.startsWith("daily:") && key !== tanaan && !key.endsWith(":kesken");
      if (key === "stats" || menneetTulokset) store.remove(key);
    }
    renderStats();
    refreshDrawer();
    toast("Tilastot nollattu.");
  }

  // ---------- Navigointi ----------
  function go(target) {
    // Vapaan pelin nollaus: uusi sarja kesken pelin. Varmistetaan vain, jos
    // jotain oikeasti menetetään.
    if (target === "refree") {
      if (freeStarted() && !confirm("Sarja alkaa alusta ja pisteet nollautuvat. Jatketaanko?")) return;
      closeDrawer();
      stopPlayback();
      startFree();
      toast("Uusi sarja.");
      return;
    }
    /* Varmistus vain siitä mikä oikeasti menetetään.
     *
     * Aiemmin tämä kysyttiin kummastakin pelimuodosta poistuttaessa, mikä oli
     * päivän pelissä yksinkertaisesti valhe: päivän sarja tallennetaan joka
     * ohituksen, arvauksen ja biisin vaihdon jälkeen, ja se palautuu samasta
     * kohdasta samoilla pisteillä. Vapaata sarjaa ei tallenneta lainkaan, eli
     * vain se katoaa. Väärä varoitus on pahempi kuin puuttuva: se opettaa
     * ohittamaan varoitukset lukematta, jolloin oikeakaan ei enää pysäytä. */
    if (target === "daily" || target === "free") {
      // Vapaa peli vapaan pelin päälle aloittaa uuden sarjan, ei vaihda muotoa.
      const uusiVapaa = target === "free" && state.mode === "free";
      if (freeStarted() && !confirm(uusiVapaa
        ? "Sarja alkaa alusta ja pisteet nollautuvat. Jatketaanko?"
        : "Kesken oleva vapaa sarja menetetään. Vaihdetaanko?")) return;
    }
    closeDrawer();
    stopPlayback();
    lahetaArvio();
    if (target === "daily") startDaily();
    else if (target === "free") startFree();
    else if (target === "stats") show("stats");
    else if (target === "help") show("help");
    else if (target === "back") show(state.rounds.length ? "game" : "results");
  }

  // ---------- Tapahtumat ----------
  function bind() {
    el.menuBtn.addEventListener("click", () => {
      if (el.body.classList.contains("drawer-open")) closeDrawer();
      else openDrawer();
    });
    if (el.aani) {
      el.aani.value = Math.round(aaniTaso() * 100);
      asetaAani(aaniTaso());
      // input eikä change: taso seuraa sormea, jotta muutoksen kuulee heti.
      el.aani.addEventListener("input", () => asetaAani(Number(el.aani.value) / 100));
    }
    // Ikkunan koon muutos vaihtaa palkin luonteen kesken kaiken.
    LEVEA.addEventListener("change", paivitaPalkki);
    paivitaPalkki();
    el.drawerClose.addEventListener("click", closeDrawer);
    el.scrim.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      // Jakoruutu on päällimmäisenä, joten se sulkeutuu ensin.
      if (el.body.classList.contains("sheet-open")) suljeJako();
      else if (el.body.classList.contains("drawer-open")) closeDrawer();
    });

    document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));

    el.playBtn.addEventListener("click", () => {
      if (audio.playing) { stopPlayback(); return; }
      playClip(cur().finished ? STEPS[STEPS.length - 1] : STEPS[cur().step]);
    });
    el.replayBtn.addEventListener("click", () => {
      if (audio.playing) { stopPlayback(); return; }
      playClip(STEPS[STEPS.length - 1]);
    });
    el.rateRow.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-rate]");
      if (!chip || cur() === undefined) return;
      saveRating(cur().song, Number(chip.dataset.rate));
      renderRate(cur().song);
    });
    el.retryBtn.addEventListener("click", loadAndStart);
    asetaPalautelinkki();
    if (el.dataConsent) {
      el.dataConsent.checked = dataLupa();
      el.dataConsent.addEventListener("change", () => {
        store.set("datalupa", el.dataConsent.checked);
        toast(el.dataConsent.checked
          ? "Kiitos. Kierrokset auttavat tasojen tarkentamisessa."
          : "Selvä, mitään ei enää lähetetä.");
      });
    }
    el.input.addEventListener("focus", updateSearchMode);
    el.input.addEventListener("blur", updateSearchMode);
    /* Toiseen sovellukseen siirtyminen katkaisee äänen iOS:ssä. Kaksi asiaa
     * meni tässä pieleen: soitto jäi päälle omassa kirjanpidossamme, jolloin
     * ensimmäinen painallus paluun jälkeen tulkittiin pysäytykseksi eikä
     * mitään soinut, ja itse äänikonteksti jäi keskeytettyyn tilaan josta se
     * ei toivu pelkällä herätyksellä. Siksi soitto pysäytetään siististi
     * poistuttaessa ja konteksti merkitään uusittavaksi. */
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { stopPlayback(); audio.revive = true; lahetaArvio(); }
    });
    /* Välilehden sulkeminen on viimeinen hetki jolloin odottava arvio voi
     * vielä lähteä. visibilitychange ei laukea kaikissa selaimissa sulkiessa,
     * pagehide laukeaa. */
    window.addEventListener("pagehide", lahetaArvio);
    // Näppäimistön avautuminen ja sulkeutuminen muuttaa näkyvää aluetta.
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateSearchMode);
      window.visualViewport.addEventListener("scroll", updateSearchMode);
    }
    window.addEventListener("resize", updateSearchMode);
    el.nextBtn.addEventListener("click", nextRound);
    el.tierBar.addEventListener("click", (e) => {
      const chip = e.target.closest("button.tchip");
      if (!chip) return;
      // Molemmissa pelimuodoissa rivi vaihtaa vain näkymää: biisit ja niiden
      // kesken jäänyt edistyminen säilyvät paikoillaan.
      state.at = Number(chip.dataset.slot);
      persistDaily();
      openRound();
    });

    el.actionBtn.addEventListener("click", () => {
      if (state.selected || exactMatch(el.input.value)) submitGuess();
      else skipStep();
    });
    // Enter arvaa aina, ei koskaan ohita vahingossa.
    el.form.addEventListener("submit", (e) => { e.preventDefault(); submitGuess(); });
    el.input.addEventListener("input", onInput);
    el.input.addEventListener("keydown", onInputKey);
    el.input.addEventListener("focus", () => { if (el.input.value.trim() && !state.selected) onInput(); });
    el.input.addEventListener("blur", () => setTimeout(closeSuggestions, 120));
    el.shareBtn.addEventListener("click", avaaJako);
    el.shareClose.addEventListener("click", suljeJako);
    el.shareScrim.addEventListener("click", suljeJako);
    el.shareNative.addEventListener("click", jaaKuva);
    el.shareCopyImg.addEventListener("click", kopioiKuva);
    el.shareCopyLink.addEventListener("click", kopioiLinkki);
    el.againBtn.addEventListener("click", () => go("free"));
    el.resetBtn.addEventListener("click", resetStats);

    document.addEventListener("keydown", (e) => {
      if (state.view !== "game" || e.target === el.input || e.target.tagName === "BUTTON") return;
      if (e.key === " ") { e.preventDefault(); el.playBtn.click(); }
      else if (e.key === "Enter" && cur().finished) nextRound();
    });
  }

  // ---------- Käynnistys ----------
  /* Kesken jäänyt sarja on tarpeeton heti kun sen päivä on vaihtunut: sitä ei
   * enää pääse pelaamaan, koska päivän peli avaa aina kuluvan päivän sarjan.
   * Siivotaan, ettei localStorageen jää päivä päivältä kasvavaa jäämää. */
  function pruneProgress() {
    const tag = ":kesken";
    const today = progressKey(todayKey());
    store.keys()
      .filter((k) => k.startsWith("daily:") && k.endsWith(tag) && k !== today)
      .forEach((k) => store.remove(k));
  }

  /* Virheteksti pelaajan kielellä. Selaimen oma viesti ("Failed to fetch")
   * on englantia eikä kerro mitä tehdä, joten se jää konsoliin. */
  function loadErrorText(err) {
    if (location.protocol === "file:") {
      return "Selain ei salli songs.json-tiedoston lukemista suoraan levyltä. "
           + "Käynnistä paikallinen palvelin, esimerkiksi python3 -m http.server, ja avaa http://localhost:8000.";
    }
    if (!navigator.onLine) return "Ei verkkoyhteyttä. Biisit haetaan uudestaan kun yhteys palaa.";
    const status = /\((\d{3})\)/.exec(String(err && err.message));
    if (status) return `Biisilistaa ei saatu palvelimelta (virhe ${status[1]}). Yritä hetken päästä uudelleen.`;
    return "Biisien lataus ei onnistunut. Tarkista verkkoyhteys ja yritä uudelleen.";
  }

  async function loadAndStart() {
    el.loadingRetry.hidden = true;
    el.loadingText.textContent = "Ladataan biisejä…";
    try {
      await loadCatalog();
      refreshDrawer();
      startDaily();          // sivu avautuu suoraan päivän peliin
    } catch (err) {
      console.error(err);
      el.loadingText.textContent = loadErrorText(err);
      // Levyltä avattua sivua ei korjaa uudelleenyritys vaan palvelin.
      el.loadingRetry.hidden = location.protocol === "file:";
      show("loading");
    }
  }

  async function init() {
    migrateStore();
    pruneProgress();
    bind();
    await loadAndStart();
  }

  init();

  /* Service worker tekee sivusta nopean ja offline-kelpoisen. Rekisteröinti
   * viimeisenä ja hiljaa: jos selain ei tue sitä tai sivu on avattu levyltä,
   * peli toimii silti tismalleen samoin. */
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => { /* ei pakollinen */ });
    });
  }
})();
