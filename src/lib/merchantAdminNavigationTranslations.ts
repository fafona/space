import { resolveSupportedLocale } from "@/lib/i18n";

export const MERCHANT_ADMIN_NAVIGATION_LOCALES = [
  "zh-cn", "zh-tw", "ja", "ko", "en", "es", "de", "fr", "tr", "it", "pl", "uk", "nl", "ro", "pt",
  "ru", "el", "cs", "sv", "hu", "be", "bg", "sr", "da", "fi", "sk", "no", "hr", "bs", "sq", "lt",
  "sl", "lv", "et", "mk", "ca", "eu", "gl", "cy", "is", "ga", "mt", "lb",
] as const;

export type MerchantAdminNavigationLocale = (typeof MERCHANT_ADMIN_NAVIGATION_LOCALES)[number];

type CompactNavigationTranslation = Record<MerchantAdminNavigationLocale, string>;

// These labels are intentionally shorter than page titles. They are used by the
// narrow merchant navigation only, where a concise noun is clearer than a long
// literal translation such as "Appointment management".
export const MERCHANT_ADMIN_COMPACT_NAVIGATION_TRANSLATIONS = {
  积分兑换: {
    "zh-cn": "积分兑换", "zh-tw": "積分兌換", ja: "ポイント交換", ko: "포인트 교환", en: "Redeem points",
    es: "Canje de puntos", de: "Punkte einlösen", fr: "Échange de points", tr: "Puan kullan", it: "Riscatta punti",
    pl: "Wymiana punktów", uk: "Обмін балів", nl: "Punten inwisselen", ro: "Schimb puncte", pt: "Trocar pontos",
    ru: "Обмен баллов", el: "Εξαργύρωση", cs: "Výměna bodů", sv: "Lös in poäng", hu: "Pontbeváltás",
    be: "Абмен балаў", bg: "Обмяна на точки", sr: "Zamena poena", da: "Indløs point", fi: "Lunasta pisteet",
    sk: "Výmena bodov", no: "Løs inn poeng", hr: "Iskoristi bodove", bs: "Iskoristi bodove", sq: "Shkëmbe pikët",
    lt: "Keisti taškus", sl: "Unovči točke", lv: "Mainīt punktus", et: "Vaheta punkte", mk: "Замени поени",
    ca: "Canvi de punts", eu: "Puntu-trukea", gl: "Trocar puntos", cy: "Cyfnewid pwyntiau", is: "Innleysa punkta",
    ga: "Úsáid pointí", mt: "Ibdel il-punti", lb: "Punkte aléisen",
  },
  预约管理: {
    "zh-cn": "预约管理", "zh-tw": "預約管理", ja: "予約", ko: "예약", en: "Bookings", es: "Citas", de: "Termine",
    fr: "Rendez-vous", tr: "Randevular", it: "Appuntamenti", pl: "Rezerwacje", uk: "Записи", nl: "Afspraken",
    ro: "Programări", pt: "Marcações", ru: "Записи", el: "Ραντεβού", cs: "Rezervace", sv: "Bokningar",
    hu: "Időpontok", be: "Запісы", bg: "Резервации", sr: "Termini", da: "Bookinger", fi: "Varaukset",
    sk: "Rezervácie", no: "Bestillinger", hr: "Rezervacije", bs: "Rezervacije", sq: "Rezervime", lt: "Rezervacijos",
    sl: "Rezervacije", lv: "Rezervācijas", et: "Broneeringud", mk: "Резервации", ca: "Reserves", eu: "Erreserbak",
    gl: "Reservas", cy: "Archebion", is: "Bókanir", ga: "Áirithintí", mt: "Prenotazzjonijiet", lb: "Reservatiounen",
  },
  订单管理: {
    "zh-cn": "订单管理", "zh-tw": "訂單管理", ja: "注文", ko: "주문", en: "Orders", es: "Pedidos", de: "Bestellungen",
    fr: "Commandes", tr: "Siparişler", it: "Ordini", pl: "Zamówienia", uk: "Замовлення", nl: "Bestellingen",
    ro: "Comenzi", pt: "Encomendas", ru: "Заказы", el: "Παραγγελίες", cs: "Objednávky", sv: "Ordrar",
    hu: "Rendelések", be: "Заказы", bg: "Поръчки", sr: "Porudžbine", da: "Ordrer", fi: "Tilaukset",
    sk: "Objednávky", no: "Ordrer", hr: "Narudžbe", bs: "Narudžbe", sq: "Porosi", lt: "Užsakymai",
    sl: "Naročila", lv: "Pasūtījumi", et: "Tellimused", mk: "Нарачки", ca: "Comandes", eu: "Eskaerak",
    gl: "Pedidos", cy: "Archebion", is: "Pantanir", ga: "Orduithe", mt: "Ordnijiet", lb: "Bestellungen",
  },
  企业管理: {
    "zh-cn": "企业管理", "zh-tw": "企業管理", ja: "企業管理", ko: "기업 관리", en: "Enterprise", es: "Empresa",
    de: "Unternehmen", fr: "Entreprise", tr: "İşletme", it: "Azienda", pl: "Firma", uk: "Бізнес", nl: "Bedrijf",
    ro: "Companie", pt: "Empresa", ru: "Бизнес", el: "Επιχείρηση", cs: "Firma", sv: "Företag", hu: "Vállalat",
    be: "Бізнес", bg: "Бизнес", sr: "Preduzeće", da: "Virksomhed", fi: "Yritys", sk: "Firma", no: "Bedrift",
    hr: "Tvrtka", bs: "Firma", sq: "Biznes", lt: "Įmonė", sl: "Podjetje", lv: "Uzņēmums", et: "Ettevõte",
    mk: "Бизнис", ca: "Empresa", eu: "Enpresa", gl: "Empresa", cy: "Busnes", is: "Fyrirtæki", ga: "Gnó",
    mt: "Negozju", lb: "Betrib",
  },
  会话: {
    "zh-cn": "会话", "zh-tw": "對話", ja: "チャット", ko: "채팅", en: "Chat", es: "Chat", de: "Chat", fr: "Chat",
    tr: "Sohbet", it: "Chat", pl: "Czat", uk: "Чат", nl: "Chat", ro: "Chat", pt: "Chat", ru: "Чат",
    el: "Συνομιλία", cs: "Chat", sv: "Chatt", hu: "Csevegés", be: "Чат", bg: "Чат", sr: "Ćaskanje",
    da: "Chat", fi: "Chat", sk: "Chat", no: "Chat", hr: "Razgovor", bs: "Razgovor", sq: "Biseda",
    lt: "Pokalbiai", sl: "Klepet", lv: "Čats", et: "Vestlus", mk: "Разговор", ca: "Xat", eu: "Txata",
    gl: "Chat", cy: "Sgwrs", is: "Spjall", ga: "Comhrá", mt: "Chat", lb: "Chat",
  },
  会员管理: {
    "zh-cn": "会员管理", "zh-tw": "會員管理", ja: "会員", ko: "회원", en: "Members", es: "Socios", de: "Mitglieder",
    fr: "Membres", tr: "Üyeler", it: "Membri", pl: "Członkowie", uk: "Учасники", nl: "Leden", ro: "Membri",
    pt: "Membros", ru: "Участники", el: "Μέλη", cs: "Členové", sv: "Medlemmar", hu: "Tagok", be: "Удзельнікі",
    bg: "Членове", sr: "Članovi", da: "Medlemmer", fi: "Jäsenet", sk: "Členovia", no: "Medlemmer", hr: "Članovi",
    bs: "Članovi", sq: "Anëtarë", lt: "Nariai", sl: "Člani", lv: "Biedri", et: "Liikmed", mk: "Членови",
    ca: "Membres", eu: "Kideak", gl: "Membros", cy: "Aelodau", is: "Meðlimir", ga: "Baill", mt: "Membri",
    lb: "Memberen",
  },
  优惠券: {
    "zh-cn": "优惠券", "zh-tw": "優惠券", ja: "クーポン", ko: "쿠폰", en: "Coupons", es: "Cupones", de: "Coupons",
    fr: "Coupons", tr: "Kuponlar", it: "Coupon", pl: "Kupony", uk: "Купони", nl: "Coupons", ro: "Cupoane",
    pt: "Cupões", ru: "Купоны", el: "Κουπόνια", cs: "Kupóny", sv: "Kuponger", hu: "Kuponok", be: "Купоны",
    bg: "Купони", sr: "Kuponi", da: "Kuponer", fi: "Kupongit", sk: "Kupóny", no: "Kuponger", hr: "Kuponi",
    bs: "Kuponi", sq: "Kuponë", lt: "Kuponai", sl: "Kuponi", lv: "Kuponi", et: "Kupongid", mk: "Купони",
    ca: "Cupons", eu: "Kupoiak", gl: "Cupóns", cy: "Cwponau", is: "Afsláttarmiðar", ga: "Cúpóin",
    mt: "Kupuni", lb: "Couponen",
  },
  经营中心: {
    "zh-cn": "经营中心", "zh-tw": "營運中心", ja: "運営", ko: "운영", en: "Operations", es: "Operaciones",
    de: "Betrieb", fr: "Opérations", tr: "Operasyonlar", it: "Operazioni", pl: "Operacje", uk: "Операції",
    nl: "Beheer", ro: "Operațiuni", pt: "Operações", ru: "Операции", el: "Λειτουργίες", cs: "Provoz",
    sv: "Drift", hu: "Működés", be: "Аперацыі", bg: "Операции", sr: "Operacije", da: "Drift", fi: "Toiminnot",
    sk: "Prevádzka", no: "Drift", hr: "Operacije", bs: "Operacije", sq: "Operacione", lt: "Veikla",
    sl: "Poslovanje", lv: "Darbība", et: "Tegevused", mk: "Операции", ca: "Operacions", eu: "Eragiketak",
    gl: "Operacións", cy: "Gweithrediadau", is: "Rekstur", ga: "Oibríochtaí", mt: "Operazzjonijiet",
    lb: "Operatiounen",
  },
  兑换记录: {
    "zh-cn": "兑换记录", "zh-tw": "兌換記錄", ja: "交換履歴", ko: "교환 내역", en: "Redemptions", es: "Canjes",
    de: "Einlösungen", fr: "Échanges", tr: "Kullanımlar", it: "Riscatti", pl: "Wymiany", uk: "Обміни",
    nl: "Inwisselingen", ro: "Schimburi", pt: "Resgates", ru: "Обмены", el: "Εξαργυρώσεις", cs: "Výměny",
    sv: "Inlösen", hu: "Beváltások", be: "Абмены", bg: "Обмени", sr: "Zamene", da: "Indløsninger",
    fi: "Lunastukset", sk: "Výmeny", no: "Innløsninger", hr: "Iskorištenja", bs: "Iskorištenja", sq: "Shkëmbime",
    lt: "Keitimai", sl: "Unovčenja", lv: "Maiņas", et: "Vahetused", mk: "Замени", ca: "Canvis", eu: "Trukeak",
    gl: "Trocos", cy: "Cyfnewidiadau", is: "Innlausnir", ga: "Malartuithe", mt: "Tisrif", lb: "Aléisungen",
  },
  充值记录: {
    "zh-cn": "充值记录", "zh-tw": "儲值記錄", ja: "チャージ履歴", ko: "충전 내역", en: "Top-ups", es: "Recargas",
    de: "Aufladungen", fr: "Recharges", tr: "Yüklemeler", it: "Ricariche", pl: "Doładowania", uk: "Поповнення",
    nl: "Opwaarderingen", ro: "Reîncărcări", pt: "Carregamentos", ru: "Пополнения", el: "Φορτίσεις", cs: "Dobití",
    sv: "Påfyllningar", hu: "Feltöltések", be: "Папаўненні", bg: "Зареждания", sr: "Dopune", da: "Optankninger",
    fi: "Lataukset", sk: "Dobitia", no: "Påfyllinger", hr: "Nadoplate", bs: "Dopune", sq: "Mbushje",
    lt: "Papildymai", sl: "Polnitve", lv: "Papildinājumi", et: "Laadimised", mk: "Дополнувања",
    ca: "Recàrregues", eu: "Kargatzeak", gl: "Recargas", cy: "Ychwanegiadau", is: "Inneignir", ga: "Breisithe",
    mt: "Żidiet", lb: "Opluedungen",
  },
  项目分类: {
    "zh-cn": "项目分类", "zh-tw": "項目分類", ja: "カテゴリ", ko: "카테고리", en: "Categories", es: "Categorías",
    de: "Kategorien", fr: "Catégories", tr: "Kategoriler", it: "Categorie", pl: "Kategorie", uk: "Категорії",
    nl: "Categorieën", ro: "Categorii", pt: "Categorias", ru: "Категории", el: "Κατηγορίες", cs: "Kategorie",
    sv: "Kategorier", hu: "Kategóriák", be: "Катэгорыі", bg: "Категории", sr: "Kategorije", da: "Kategorier",
    fi: "Luokat", sk: "Kategórie", no: "Kategorier", hr: "Kategorije", bs: "Kategorije", sq: "Kategori",
    lt: "Kategorijos", sl: "Kategorije", lv: "Kategorijas", et: "Kategooriad", mk: "Категории", ca: "Categories",
    eu: "Kategoriak", gl: "Categorías", cy: "Categorïau", is: "Flokkar", ga: "Catagóirí", mt: "Kategoriji",
    lb: "Kategorien",
  },
  项目管理: {
    "zh-cn": "项目管理", "zh-tw": "項目管理", ja: "アイテム", ko: "항목", en: "Items", es: "Artículos", de: "Artikel",
    fr: "Articles", tr: "Öğeler", it: "Articoli", pl: "Pozycje", uk: "Позиції", nl: "Items", ro: "Articole",
    pt: "Itens", ru: "Позиции", el: "Στοιχεία", cs: "Položky", sv: "Artiklar", hu: "Tételek", be: "Пазіцыі",
    bg: "Артикули", sr: "Stavke", da: "Varer", fi: "Kohteet", sk: "Položky", no: "Varer", hr: "Stavke",
    bs: "Stavke", sq: "Artikuj", lt: "Elementai", sl: "Postavke", lv: "Vienumi", et: "Üksused", mk: "Ставки",
    ca: "Articles", eu: "Elementuak", gl: "Elementos", cy: "Eitemau", is: "Atriði", ga: "Míreanna",
    mt: "Oġġetti", lb: "Artikelen",
  },
} satisfies Record<string, CompactNavigationTranslation>;

export type MerchantAdminCompactNavigationSource = keyof typeof MERCHANT_ADMIN_COMPACT_NAVIGATION_TRANSLATIONS;

export function getMerchantAdminCompactNavigationLabel(
  source: MerchantAdminCompactNavigationSource,
  locale: string | null | undefined,
) {
  const normalized = resolveSupportedLocale(locale).toLowerCase();
  const language = normalized === "zh-cn" || normalized === "zh-tw"
    ? normalized
    : normalized.split("-")[0] || "en";
  const resolvedLocale = MERCHANT_ADMIN_NAVIGATION_LOCALES.includes(language as MerchantAdminNavigationLocale)
    ? language as MerchantAdminNavigationLocale
    : "en";
  return MERCHANT_ADMIN_COMPACT_NAVIGATION_TRANSLATIONS[source][resolvedLocale];
}
