# AirQ Competition Helpers — Uživatelská příručka

Praktický návod pro **organizátory soutěží**, kteří připravují fotografický
materiál pro letecké soutěže FAI (letecká rally a přesné létání). Pokrývá oba
nástroje od začátku do konce:

- **Map Corridors** — načtěte trať, najděte a vytřiďte fotky na mapě,
  kategorizujte je a zvolte, kde se odpovědní list rozdělí na stránky.
- **Photo Helper** — rozmístěte vybrané fotky do tiskových sad, dolaďte každý
  snímek a vyexportujte tisknutelné PDF.

Oba nástroje si data předávají automaticky, takže přirozený postup je
**Map Corridors → Photo Helper**. Vše se ukládá ve vašem počítači (bez účtu, bez
připojení k internetu); viz [Data a ukládání](#5-data-a-ukládání).

> 🇬🇧 English version: [USER_MANUAL.md](./USER_MANUAL.md).
> Technické pozadí a interní detaily najdete v
> [`photo-map-culling/guide.md`](./photo-map-culling/guide.md) a v rozhodnutích
> (ADR) v [`photo-map-culling/decisions.md`](./photo-map-culling/decisions.md).

---

## 1. Instalace a spuštění

1. Stáhněte si nejnovější `photo-helper-vX.Y.Z.exe` ze stránky **Releases** na
   GitHubu projektu (Windows 10/11, 64bitové). Je to **přenosný** spustitelný
   soubor — nic se neinstaluje, stačí ho spustit.
2. Aplikace záměrně není podepsaná, takže při prvním spuštění Windows SmartScreen
   zobrazí *„Windows protected your PC"*. Klikněte na **More info → Run anyway**.
3. Otevře se rozcestník se dvěma dlaždicemi — **Photo Helper** a
   **Map Corridors** — plus přepínač jazyka (čeština / angličtina) a nastavení
   Mapbox tokenu.

### Jednorázové nastavení mapy (Mapbox token)

Map Corridors vykresluje mapové podklady. V nastavení **Mapbox** (z rozcestníku
nebo přímo v aplikaci) jednou vložte svůj přístupový token Mapbox; uloží se
lokálně a používá se opakovaně. Bez tokenu se nemusí vykreslit mapový podklad,
ale zbytek postupu funguje.

---

## 2. Volba soutěže a disciplíny

- Vyberte nebo vytvořte **soutěž** — každá je samostatným pracovním prostorem se
  svými fotkami, tratí a nastavením. Přepnutí soutěže nikdy nemíchá data.
- Zvolte **disciplínu**: **Rally** (dva odpovědní listy, Sada 1 / Sada 2) nebo
  **Přesné létání** (jeden list). Disciplína mění, které ovládací prvky se
  zobrazí — např. výběr rozdělení sad je pouze pro rally.

---

## 3. Map Corridors — hledání a třídění na mapě

### 3.1 Načtení trati

Přetáhněte soubor trati **KML/GPX** na mapu. Map Corridors sestaví trať
(SP → TP1 … TPn → FP) a její navigační koridory. Otočné body, které z trati
načte, později řídí výběr rozdělení sad.

### 3.2 Import fotek

Přetáhněte dávku fotek **JPG/PNG** na stejné místo (rozřazení se řídí typem
souboru — žádné přepínání režimu):

- Fotky **s GPS v EXIF** se umístí jako šedé tečky v místě pořízení; mapa se
  přiblíží tak, aby je zobrazila všechny. U velkých dávek se zobrazí indikátor
  průběhu.
- Fotky **bez GPS** se shromáždí v zásobníku **„Bez GPS"** u okraje mapy.
  Každou přetáhněte na její skutečné místo (nebo kliknutím na řádek v zásobníku
  umístěte předběžný špendlík, který pak posunete).

Opakovaný import téhož souboru se automaticky přeskočí (kontrola podle obsahu),
takže můžete složku bez obav přetáhnout znovu, aniž by vznikly duplicity.

### 3.3 Rozhodnutí o každé fotce

Klikněte na tečku fotky (nebo na její řádek v seznamu vpravo) a otevře se okno:

| Akce | Význam |
|---|---|
| **Fotka trati** (modrá) | Ponechat jako traťovou (en-route) fotku → traťové sady v editoru. |
| **Fotka otočného bodu** (fialová) | Ponechat jako fotku otočného bodu → sady OB v editoru. |
| **Neutrální** | Nerozhodnuto — do editoru se neposílá. |
| **Odmítnuté** | Vyřadit — do editoru se neposílá. |
| **Štítek (A, B, …)** | Přiřadit štítek odpovědního listu pro hodnocení. |

- **Dvojklik** na náhled otevře náhled v plném rozlišení.
- **Posun špendlíku objektu**: přetáhněte tečku na skutečný objekt, pokud místo
  pořízení neodpovídá poloze hledaného prvku.
- **Porovnání variant**: podržte Ctrl/Cmd a klikněte (nebo Shift+klik pro
  rozsah) na několik fotek téhož bodu a přes **Porovnat** vyberte nejlepší
  vedle sebe.

### 3.4 Seznam fotek vpravo

Fotky jsou seskupené podle rozhodnutí: **Otočné body – vybrané**,
**Traťové foto – vybrané**, **Neutrální**, **Odmítnuté**, **Bez GPS**. Můžete:

- **Přetáhnout řádek mezi oběma skupinami vybraných** a přeřadit otočný ↔ traťový.
- **Přejmenovat** fotku (tužka) na pracovní název jako `TP1` — vlastní název ji
  doprovází do editoru, aniž by se měnil původní název souboru.
- **Smazat** fotku ze soutěže (✕).

### 3.5 Ovládání mapy klávesnicí

Mapa reaguje na stejné klávesy jako Google Earth, ať jste naposledy klikli
kamkoli (přednost má jen psaní do textového pole):

| Klávesa | Akce |
|---------|------|
| **← ↑ ↓ →** | Posun mapy |
| **Shift + ← / →** (nebo **Ctrl + ← / →**) | Otáčení (kompas se otáčí s mapou) |
| **Shift + ↑ / ↓** (nebo **Ctrl + ↑ / ↓**) | Naklonění pohledu |
| **Page Up / Page Down** | Přiblížení / oddálení |
| **+ / −** | Přiblížení / oddálení |
| **N** | Natočit na sever |
| **U** | Pohled kolmo dolů |
| **R** | Obnovit pohled (sever + kolmo dolů) |

Podržením klávesy se pohyb opakuje. Kompas v levém horním rohu také vrátí
mapu na sever, kdykoli je otočená.

### 3.6 Volba, kde se sady rozdělí (Rally)

Použijte výběr **„Sada 2 začíná od"** v horní části seznamu a zvolte otočný bod
trati (TP1, TP2, …):

- Každá fotka, jejíž poloha **podél trati** je na úrovni daného TP nebo za ním,
  jde do **Sady 2**; ostatní zůstanou v **Sadě 1** — pro traťové fotky i fotky
  otočných bodů.
- Zvolený TP dostane na mapě odznak nůžek a ve skupinách vybraných se objeví
  oddělovač **„Sada 2"** v místě řezu.
- Volba **„Bez rozdělení (jedna sada)"** rozdělení zruší.

Otočné body pocházejí z **trati**, takže to funguje, i když žádná z vašich fotek
není fotkou otočného bodu. Soutěže v přesném létání mají jednu sadu a tento
ovládací prvek nezobrazují.

### 3.7 Tisk mapy a export do Google Earth

Dvě tlačítka v liště promění to, co je na obrazovce, v podklad k rozdání:

- **Tisk mapy** uloží aktuální pohled jako obrázek A4 v rozlišení 300 DPI.
  Výsledek je vždy přesně A4 bez ohledu na nastavené měřítko zobrazení
  ve Windows.
- **Exportovat KML** zapíše trať, koridory, pozemní značky a špendlíky fotek do
  souboru `.kml`, který otevřete v Google Earth.

**Obojí nese název každé fotky**, takže na pojmenování fotek záleží. Do mapy se
vždy tiskne ten nejvýstižnější údaj, který fotka má:

| Co má fotka nastaveno | Co se vytiskne u jejího bodu |
|-----------------------|------------------------------|
| Vlastní název (přejmenovaná v seznamu) | `TP1` |
| Vlastní název **a** štítek odpovědního listu | `A - TP1` |
| Jen štítek odpovědního listu | `A` |
| Ani jedno | název souboru z fotoaparátu, např. `DSC_0123.JPG` |

Oštítkovaná fotka vytiskne jen svůj štítek — název souboru z fotoaparátu se
vynechá, protože soutěžící hledá `A` a `A - DSC_0123.JPG` by na papíře jen
ubíral místo. Fotka bez vlastního názvu i bez štítku se pořád tiskne názvem
souboru, takže žádný bod nezůstane bez popisku. Fotky, na kterých vám záleží,
proto před exportem přejmenujte (ikona tužky v seznamu fotek) — jinak bude
výstup jen změtí názvů souborů z fotoaparátu. V **KML** navíc zůstává původní
název souboru v závorce (`A - TP1 (DSC_0123.JPG)`), abyste se od špendlíku
v Google Earth vždy dostali zpět ke konkrétnímu souboru. Odmítnuté fotky se do
obou exportů nedostanou, stejně jako je nevidíte na mapě. Tam, kde leží několik
fotek na stejném místě, se jejich názvy poskládají pod sebe, aby zůstaly
čitelné.

### 3.8 Odeslání do editoru

Klikněte na **Poslat do editoru (N)** — N je počet vybraných fotek. Výběr
(i rozdělení) přejde do Photo Helperu, který se otevře s předvyplněnými sadami.
Pokud jsou některé fotky bez GPS stále v zásobníku (neumístěné), panel vás
upozorní, protože fotky ponechané v zásobníku se nepřenášejí.

---

## 4. Photo Helper — rozložení, úpravy, export

### 4.1 Sady

Pro rally máte **Sadu 1** a **Sadu 2** (dvě stránky odpovědního listu); přesné
létání má jednu. Fotky odeslané z Map Corridors přijdou už rozřazené:

- Traťová vs. otočný bod podle kategorie, kterou jste zvolili.
- Sada 1 vs. Sada 2 podle rozdělení, které jste zvolili (nebo výchozí naplnění).
- Co se nevejde na plnou stránku, čeká v **zásobníku kandidátů** dole —
  přetáhněte to do libovolného volného místa.

Pokud **změníte rozdělení** zpět v Map Corridors a vrátíte se, editor přerovná
umístěné fotky tak, aby odpovídaly, a **zachová ořez i štítek** každé fotky.

### 4.2 Úprava fotky

Klikněte na pozici a upravujte: **jas, kontrast, ostrost, vyvážení bílé**, plus
ořez/přiblížení/posun. Štítky (čísla TP / písmena) se vypálí do tisku ve
velikosti vyladěné podle disciplíny. Úpravy jsou nedestruktivní a uloží se.

### 4.3 Zástupné místo „Bez fotky"

Pro otočný bod, ke kterému nemáte fotku, klikněte na prázdné pozici na
**Vložit „bez fotky"**. Rezervuje pozici prázdnou označenou buňkou, takže okolní
číslování SP/TP/FP zůstane správné. Zástupná místa se vytisknou jako prázdná
označená buňka a nikdy nebrání exportu.

### 4.4 Ruční přidání nebo odebrání fotek

Pomocí **Přidat fotky** importujete přímo do editoru (duplicity se přeskočí).
Odebrání fotky, která přišla z mapy, ji odebere jen z listu — sdílený snímek
zůstane k dispozici, takže opětovné odeslání z Map Corridors dál funguje.

### 4.5 Export PDF

Klikněte na **Export PDF**. Mřížky se vytisknou ve zvoleném rozložení
(na výšku / na šířku) s podporou českých znaků. Pokud některé fotce chybí
obrazová data, export zobrazí srozumitelnou hlášku s návodem (znovu naimportovat
nebo odebrat dotčené buňky) místo nesrozumitelné chyby.

---

## 5. Data a ukládání

- Vše se ukládá lokálně do **OPFS** (Origin Private File System) prohlížeče /
  Electronu, zvlášť pro každou soutěž — fotky, trať, rozhodnutí, štítky i
  rozdělení přečkají restart.
- Oba nástroje si předávají data jediným souborem `map-picks.json` na soutěž
  (jednosměrně, Map Corridors → Photo Helper). **Zrušení výběru** fotky v
  Map Corridors ji při dalším synchronizování odebere z editoru.
- Není potřeba žádný server, účet ani internet (kromě mapových podkladů).

---

## 6. Řešení potíží

| Příznak | Řešení |
|---|---|
| *„Windows protected your PC"* při spuštění | Klikněte na **More info → Run anyway** (aplikace záměrně není podepsaná). |
| Mapový podklad je prázdný | Nastavte svůj **Mapbox token** v nastavení. |
| Fotka bez GPS nedorazila do editoru | Je stále v **zásobníku Bez GPS** — přetáhněte ji na mapu a odešlete znovu. |
| Fotka, o které víte, že má GPS, skončila v **Bez GPS** | Nejčastěji jde o *kopii* originálu (z messengeru nebo z exportu) — té se cestou GPS odstraní a naimportuje se jako samostatná fotka. Porovnejte název souboru s tím na mapě. Pokud import místo toho hlásil *„nepodařilo se otevřít"*, soubor v tu chvíli nešel přečíst (byl přesunutý, nebo na kartě či síťovém disku, který vypadl) — vraťte ho na místo a naimportujte znovu. |
| Vytisknutá mapa ukazuje jen názvy souborů z fotoaparátu | Nic není přejmenované ani oštítkované. Přejmenujte fotky v seznamu (ikona tužky), nebo jim nastavte štítky odpovědního listu — obojí název souboru na tisku nahradí. Viz [3.7](#37-tisk-mapy-a-export-do-google-earth). |
| Chybí výběr „Sada 2 začíná od" | Jste v **přesném létání** (jedna sada), nebo **trať nemá načtené otočné body**. |
| Dorazilo méně fotek, než jste čekali | Zkontrolujte upozornění na fotky bez GPS; přenášejí se jen **vybrané** fotky. |
| Export PDF hlásí chybějící snímky | Znovu naimportujte dotčené fotky v editoru, nebo odeberte tyto buňky, a exportujte znovu. |

---

## 7. Slovníček

- **SP / TP / FP** — Start Point / Turning Point (otočný bod) / Finish Point trati.
- **Traťová fotka** — fotka na trati (mezi otočnými body).
- **Fotka otočného bodu** — fotka otočného bodu.
- **Sada 1 / Sada 2** — dvě stránky odpovědního listu (rally).
- **Rozdělení sad (řez)** — otočný bod trati, kde končí Sada 1 a začíná Sada 2.
- **Zásobník kandidátů** — odkládací plocha v editoru pro fotky, které ještě
  nejsou umístěné v žádné pozici.
- **Zástupné místo** — rezervovaná pozice „bez fotky" pro chybějící otočný bod.
