/* HittiSpotin service worker.
 *
 * Kaksi tehtävää: peli aukeaa hetkessä ja toimii ilman verkkoa. Metrossa ja
 * hississä äänipätkät eivät tietenkään lataudu, mutta sivu itse aukeaa ja
 * kertoo sen suomeksi sen sijaan että selain näyttäisi oman virhesivunsa.
 *
 * Välimuistin nimessä on versio. Kun se vaihtuu, vanha poistetaan kokonaan,
 * joten jumiin jäänyttä välimuistia ei pääse syntymään.
 */
const VERSIO = "hittispotti-v90";

/* Sovelluksen juuri. Vain tähän osoitettu navigointi kelpaa offline-varasivuksi. */
const JUURI = new URL("./", self.location).pathname;

/* Sivupohja esiladataan asennuksessa. songs.json ei ole mukana: peli hakee
 * sen joka tapauksessa heti, ja esilataus tarkoittaisi saman 780 kt:n
 * lataamista kahdesti. Se päätyy välimuistiin ensimmäisellä haulla. */
const POHJA = [
  "./",
  "./style.css?v=90",
  "./app.js?v=90",
  "./favicon.svg?v=90",
  "./icon-180.png?v=90",
  "./icon-192.png?v=90",
  "./manifest.webmanifest?v=90",
  "./fonts/bricolage-latin.woff2",
  "./fonts/bricolage-latin-ext.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSIO);
    // Yksittäisen tiedoston puuttuminen ei saa kaataa koko asennusta.
    await Promise.all(POHJA.map((u) => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const nimet = await caches.keys();
    await Promise.all(nimet.filter((n) => n !== VERSIO).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Vain oma sivusto. Applen esikuuntelut ja kansikuvat ovat isoja ja
  // vanhenevat, ja kävijälaskurin pitää saada mennä perille sellaisenaan.
  if (url.origin !== self.location.origin) return;
  // Arviointityökalu rakennetaan uusiksi jatkuvasti: siitä ei saa jäädä
  // vanhaa versiota välimuistiin.
  if (url.pathname.includes("arviointi")) return;

  // Sivupyyntö: verkko ensin, jotta uusi versio otetaan heti käyttöön.
  // Ilman verkkoa tarjotaan välimuistista.
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const vastaus = await fetch(req);
        /* Vain onnistunut etusivu talteen. Aiemmin tähän tallennettiin mikä
         * tahansa navigointi avaimella "./" ja ilman tilakoodin tarkistusta.
         * Yksi käynti virheellisessä osoitteessa sivuston alta korvasi siis
         * offline-varasivun virhesivulla: mitattuna välimuistin "./" vaihtui
         * 14 444 tavun pelistä 335 tavun 404-sivuun. Sama olisi käynyt
         * hetkellisestä palvelinvirheestä. */
        if (vastaus.ok && url.pathname === JUURI) {
          const c = await caches.open(VERSIO);
          c.put("./", vastaus.clone());
        }
        return vastaus;
      } catch {
        return (await caches.match("./")) || Response.error();
      }
    })());
    return;
  }

  /* Muu oma aineisto: välimuisti ensin. Kaikki versioidaan osoitteessa
   * (?v= ja ?k=), joten välimuistista saatu on aina oikea versio – uusi
   * versio on eri osoite ja menee verkkoon. */
  e.respondWith((async () => {
    const osuma = await caches.match(req);
    if (osuma) return osuma;
    try {
      const vastaus = await fetch(req);
      if (vastaus.ok && vastaus.type === "basic") {
        const c = await caches.open(VERSIO);
        c.put(req, vastaus.clone());
      }
      return vastaus;
    } catch {
      return Response.error();
    }
  })());
});
