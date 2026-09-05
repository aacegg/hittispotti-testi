# HittiSpotin esikatselu

Tämä repo on **kone­tuotettu**. Älä muokkaa tiedostoja käsin: seuraava ajo
ylikirjoittaa ne. Kaikki muutokset tehdään varsinaiseen projektiin ja tuodaan
tänne komennolla:

    python3 scripts/tee_esikatselu.py --kohde <tämän repon polku>

## Mikä tämä on

Paikka, jossa muutoksen näkee ennen kuin se menee hittispotti.fi:hin.

## Miten tämä eroaa oikeasta sivustosta

- **Ei CNAME-tiedostoa.** Se sisältäisi "hittispotti.fi", ja kaksi sivustoa
  samalla osoitteella voi kaataa oikean sivun.
- **Ei tilastoja.** Palvelimen osoite on tyhjä, joten täällä pelatut kierrokset
  eivät kirjaudu mihinkään. Se on tarkoituksellista: ulkoasua testatessa
  klikkaillaan läpi biisejä joita ei edes yritetä arvata, ja ne vääristäisivät
  vaikeustasojen kalibrointia aina saman päivän viideltä biisiltä.
- **Ei hakukoneille.** robots.txt kieltää kaiken ja sivulla on noindex.
- **Näyttää erilaiselta.** Välilehden otsikko alkaa sanalla ESIKATSELU ja
  yläreunassa on keltamusta raita.

Peli itse on tässä identtinen oikean kanssa.
