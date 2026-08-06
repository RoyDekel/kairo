# KAIRO × Hugging Face — מסמך השוואה והחלטה

**תאריך:** 6 באוגוסט 2026
**מטרה:** להחליף את מנוע החיזוי המסומלץ של KAIRO במנוע אמיתי, מבוסס מודלים ודאטה שניתן להתממשק אליהם.
**מסקנת המסמך בשורה אחת:** יש ב‑Hugging Face מודל מצוין שפותר את בעיית החיזוי (Chronos‑2), אבל **אין ב‑Hugging Face את הדאטה** — וזה הצוואר בקבוק האמיתי של KAIRO, לא המודל.

---

## 0. האמת המקצועית לפני הטבלאות

אני חייב לפתוח בזה, כי כל השאר תלוי בו.

**1. הבעיה של KAIRO היא לא בעיית מודל. היא בעיית דאטה.**
ההיסטוריה של 30/90 יום והתחזית ל‑7 יום ב‑KAIRO מיוצרות היום סינתטית. אם נחבר מודל foundation מעולה לדאטה מסומלץ, נקבל תחזית מרשימה של דאטה מומצא. אפס ערך למשתמש. **סדר העדיפויות הנכון הוא: דאטה → לוגינג → מודל.** לא להפך.

**2. Hugging Face לא מחזיק דאטה של מחירי טיסות.**
חיפוש ממצה ב‑HF Datasets על `flight price`, `airfare`, `airline` החזיר בדיוק שני דאטהסטים רלוונטיים, שניהם זעירים (`n<1K`) ומקומיים:

| דאטהסט | גודל | רישיון | שימושיות ל‑KAIRO |
|---|---|---|---|
| [`openagent/flight-prices-socal-to-nyc-6-15`](https://huggingface.co/datasets/openagent/flight-prices-socal-to-nyc-6-15) | n<1K | AGPL‑3.0 | קו אחד, חלון תאריכים אחד. Toy dataset. |
| [`Karosi/africa-flight-prices`](https://huggingface.co/datasets/Karosi/africa-flight-prices) | n<1K | לא מוגדר | לא רלוונטי ל‑32 ההאבים של KAIRO. |

כל השאר תחת `airline` הם sentiment של טוויטר, ביקורות, ו‑FAQ. **אפס ערך לחיזוי מחירים.**
המשמעות: את הדאטה צריך להביא מחוץ ל‑HF, ואת רובו KAIRO תצטרך **לייצר בעצמה**.

**3. HF Inference API (serverless) לא מגיש מודלי time‑series. בכלל.**
בדקתי ישירות מול ה‑API:
`GET /api/models?inference_provider=all&pipeline_tag=time-series-forecasting` → **מחזיר מערך ריק.**
זאת אומרת: אי אפשר לעשות `POST https://router.huggingface.co/...` ל‑Chronos ולקבל תחזית. הבחירה שלך ב"HF Inference API" תקפה ל‑embeddings ול‑LLM, אבל **לא לחיזוי**. לחיזוי צריך **HF Inference Endpoints** (dedicated container עם custom handler) — עדיין HF, עדיין קריאת HTTP מהשרת, אבל מודל תמחור ותפעול אחר לגמרי. פירוט בסעיף 5.

---

## 1. שכבה A — מודל החיזוי (הלב של KAIRO)

### 1.1 טבלת השוואה

| מודל | ספק | פרמטרים | רישיון | Covariates עתידיים | Context / Horizon | מסחרי? | ציון ל‑KAIRO |
|---|---|---|---|---|---|---|---|
| **[amazon/chronos-2](https://huggingface.co/amazon/chronos-2)** | Amazon | 120M | **Apache‑2.0** | ✅ נייטיב (real + categorical) | 8192 / 1024 | ✅ | **9.5 / 10** |
| [autogluon/chronos-2-small](https://huggingface.co/autogluon/chronos-2-small) | AutoGluon | ~30M | Apache‑2.0 | ✅ | 8192 / 1024 | ✅ | 8.5 / 10 (גרסת CPU זולה) |
| [amazon/chronos-bolt-base](https://huggingface.co/amazon/chronos-bolt-base) | Amazon | 200M | Apache‑2.0 | 🧩 רק דרך regressor חיצוני | 2048 / 64 | ✅ | 7 / 10 |
| [google/timesfm-2.5-200m-transformers](https://huggingface.co/google/timesfm-2.5-200m-transformers) | Google | 200M | Apache‑2.0 | חלקי | ארוך | ✅ | 7.5 / 10 |
| [Datadog/Toto-Open-Base-1.0](https://huggingface.co/Datadog/Toto-Open-Base-1.0) | Datadog | ~150M | Apache‑2.0 | multivariate | ארוך | ✅ | 7 / 10 (מכוון observability) |
| [ibm-granite/granite-timeseries-ttm-r2](https://huggingface.co/ibm-granite/granite-timeseries-ttm-r2) | IBM | **~1M** | Apache‑2.0 | ✅ exogenous | קצר | ✅ | 8 / 10 (הכי זול להריץ) |
| [NX-AI/TiRex](https://huggingface.co/NX-AI/TiRex) | NXAI | 35M | `license:other` | ✅ | ארוך | ⚠️ בדיקה משפטית | 5 / 10 |
| [Salesforce/moirai-2.0-R-small](https://huggingface.co/Salesforce/moirai-2.0-R-small) | Salesforce | small | **CC‑BY‑NC‑4.0** | ✅ | ארוך | ❌ **לא מסחרי** | 2 / 10 |
| [Maple728/TimeMoE-200M](https://huggingface.co/Maple728/TimeMoE-200M) | קהילה | 200M | Apache‑2.0 | ❌ | בינוני | ✅ | 5 / 10 |
| [NeoQuasar/Kronos-base](https://huggingface.co/NeoQuasar/Kronos-base) | קהילה | base | MIT | ❌ | K‑line ממוקד | ✅ | 4 / 10 (בנוי ל‑OHLC פיננסי) |

### 1.2 ההמלצה: `amazon/chronos-2`

זו לא בחירה קרובה. הסיבות:

- **Covariates עתידיים ידועים באופן נייטיב.** זה הפיצ'ר היחיד שבאמת משנה את התוצאה עבור KAIRO. מחיר טיסה לא נקבע רק מהמחיר של אתמול — הוא נקבע מ‑`days_to_departure`, יום בשבוע של ההמראה, חגים, עונתיות, ו**אירוע גדול ביעד**. כל אלה ידועים מראש. Chronos‑2 מקבל אותם כעמודות `future_df` ומתמחר אותם. Chronos‑Bolt ו‑TimesFM לא עושים את זה נייטיב — הם דורשים regressor חיצוני שמודל רק אפקט לכל timestep, לא אפקטים לאורך זמן.
- **תחזיות קוונטיליות** (`quantile_levels=[0.1, 0.5, 0.9]`). זה **בדיוק** ה‑confidence score שה‑UI של KAIRO כבר מציג. הרוחב בין q10 ל‑q90 הוא הביטחון. לא צריך להמציא היוריסטיקה — המודל מחזיר אותה.
- **Apache‑2.0 נקי.** אפשר להשתמש מסחרית, גם אם KAIRO תהפוך למוצר בתשלום. זה פוסל את Moirai (CC‑BY‑NC) לחלוטין ומעמיד את TiRex בסימן שאלה.
- **120M פרמטרים, רץ על CPU.** ~$0.13/שעה על Inference Endpoint. לא צריך GPU.
- **Zero‑shot.** אפשר להתחיל בלי לאמן כלום ביום הראשון.

**חלופת גיבוי:** `ibm-granite/granite-timeseries-ttm-r2` — ~1M פרמטרים בלבד, exogenous נתמך, Apache‑2.0. אם עלות ה‑endpoint תהיה בעיה, זה המודל שרץ כמעט בחינם. פחות מדויק, אבל זול פי כמה.

**מה לא לעשות:** אל תיגע ב‑Moirai. `cc-by-nc-4.0` = אסור שימוש מסחרי. אם KAIRO אי פעם תגבה כסף או תציג פרסומות, זו הפרת רישיון.

---

## 2. שכבה B — הדאטה (הפער האמיתי)

Hugging Face לא פותר את זה. הנה מה שכן.

### 2.1 מקורות דאטה חיצוניים — מצב אוגוסט 2026

| מקור | מה נותן | סטטוס ב‑2026 | עלות | המלצה |
|---|---|---|---|---|
| **Amadeus Flight Price Analysis** (`/v1/analytics/itinerary-price-metrics`) | טווח מחירים היסטורי + קוורטילים לפי מסלול, מבוסס ML על booking data אמיתי | ⚠️ **Self‑Service בפירוק** — מפתחות self‑service מושבתים באמצע 2026 | Enterprise / Quick Connect | הכי איכותי, אבל נתיב הגישה הזול נסגר. צריך לבדוק תמחור Enterprise. |
| **Travelpayouts / Aviasales Data API** | טרנדים של מחירים, יעדים פופולריים, cache של חיפושים | פעיל, אבל דורש פרויקט עם **50K+ MAU** | חינם (אפיליאייט) | לא ריאלי ל‑KAIRO היום. שווה לחזור אליו אחרי traction. |
| **Kiwi.com Tequila** | חיפוש טיסות גמיש, virtual interlining | פעיל | tiered | טוב ל‑live search, פחות להיסטוריה. |
| **Duffel** | הזמנות + הצעות מחיר בזמן אמת | פעיל | per‑booking | מצוין ל‑live, אפס היסטוריה. |
| **הלוגינג העצמי של KAIRO** | snapshot יומי של מחירים ל‑N מסלולים ל‑Supabase | תלוי בכם בלבד | ~$0 | ✅ **זה המהלך.** |

### 2.2 ההמלצה: תתחילו לייצר את הדאטה שלכם היום

זו ההמלצה החשובה ביותר במסמך. **בנו cron job שרץ פעם ביום, שולף מחיר עבור ~50 צמדי מסלול×תאריך, ורושם שורה ל‑Supabase.**

```
flight_price_snapshots
  id | route (TLV-KRK) | departure_date | return_date | observed_at
     | price | currency | carrier | days_to_departure | source
```

למה זה קריטי:

- אחרי 90 יום יש לכם 4,500 נקודות אמיתיות — מספיק ל‑zero‑shot אמין עם Chronos‑2.
- אחרי שנה יש לכם דאטהסט שאף אחד אחר לא מחזיק. **זה ה‑moat של KAIRO.** לא המודל — Chronos‑2 זמין לכולם בחינם.
- זה עולה כמעט כלום. Supabase free tier מחזיק את זה בקלות שנים.

**האמת שלא נעים לשמוע:** אם לא תתחילו ללוגג היום, גם בעוד חצי שנה תהיו באותו מקום — עם מודל מעולה ובלי מה להאכיל אותו. כל יום שעובר בלי לוגינג הוא יום של דאטה שאבד לתמיד.

---

## 3. שכבה C — התאמת אירועים גלובליים

כאן HF כן נותן ערך ישיר, ובזול.

### 3.1 חלוקת אחריות

| רכיב | מקור | הערה |
|---|---|---|
| דאטה של אירועים (קונצרטים/ספורט/פסטיבלים) | **Ticketmaster Discovery API / SeatGeek / PredictHQ** | HF לא מחזיק את זה. חייב API חיצוני. |
| נירמול והתאמה סמנטית (עיר, מקום, שם אמן) | **Hugging Face embeddings** | ✅ זה החלק שלנו. |
| דירוג רלוונטיות (איזה אירוע באמת ישפיע על מחיר) | **Reranker + חוקים** | ✅ |

### 3.2 מודלי embedding — כולם זמינים דרך HF Inference

| מודל | ממדים | רב־לשוני | מהירות | המלצה |
|---|---|---|---|---|
| **[intfloat/multilingual-e5-base](https://huggingface.co/intfloat/multilingual-e5-base)** | 768 | ✅ 100 שפות (כולל עברית) | בינוני | ✅ **הבחירה.** שמות מקומות ואמנים מגיעים בשפות מקומיות. |
| [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) | 384 | ✅ | מהיר | חלופה זולה. |
| [BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3) | 1024 | ✅ | איטי יותר | הכי חזק רב־לשונית, יקר יותר. |
| [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) | 384 | ❌ אנגלית | מהיר מאוד | רק אם הכל באנגלית. |
| [google/embeddinggemma-300m](https://huggingface.co/google/embeddinggemma-300m) | 768 | ✅ | מהיר | חדש, רישיון Gemma — לקרוא לפני מסחרי. |
| [BAAI/bge-reranker-large](https://huggingface.co/BAAI/bge-reranker-large) | — | ✅ | — | לשלב דירוג שני. |

**ארכיטקטורה מומלצת:** משוך אירועים מ‑Ticketmaster → הטמע עם `multilingual-e5-base` → אחסן ב‑Supabase עם `pgvector` → חפש ב‑cosine similarity לפי `(עיר יעד, חלון תאריכים)` → דרג עם `bge-reranker-large` → הזן את `event_impact_score` **בחזרה כ‑covariate ל‑Chronos‑2**.

זה הלולאה שסוגרת את המעגל של KAIRO: האירועים לא רק "מוצגים ליד הטיסה", הם **משפיעים על התחזית**. זה הפיצ'ר שיבדיל אתכם מ‑Hopper ומ‑Google Flights.

---

## 4. שכבה D — LLM בתוך האפליקציה

זמין ישירות דרך HF Inference Providers (תואם OpenAI SDK, קריאת HTTP רגילה מ‑`server.js`).

| מודל | גודל | רישיון | שימוש ב‑KAIRO |
|---|---|---|---|
| **[openai/gpt-oss-20b](https://huggingface.co/openai/gpt-oss-20b)** | 20B | Apache‑2.0 | ✅ הסברי המלצה בשפה טבעית. יחס עלות/איכות מצוין. |
| [meta-llama/Llama-3.1-8B-Instruct](https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct) | 8B | Llama 3.1 | זול ומהיר, רב־לשוני. |
| [Qwen/Qwen3-8B](https://huggingface.co/Qwen/Qwen3-8B) | 8B | Apache‑2.0 | חלופה נקייה רישיונית. |
| [deepseek-ai/DeepSeek-V4-Flash](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash) | MoE | MIT | לאיכות גבוהה, latency נמוך. |
| [openai/gpt-oss-120b](https://huggingface.co/openai/gpt-oss-120b) | 120B | Apache‑2.0 | overkill ל‑KAIRO. |

**דעה מקצועית:** ה‑LLM הוא ה‑nice‑to‑have, לא ה‑must. אל תשקיעו בו לפני ששכבות A ו‑B עובדות. משפט כמו *"המחיר ירד 12% ב‑3 השבועות האחרונים ויש קונצרט של Coldplay בקרקוב ב‑14 בספטמבר — קנה עכשיו"* שווה זהב, אבל רק אם המספרים מאחוריו אמיתיים. LLM שמנסח יפה נתונים מומצאים הוא הדבר הגרוע ביותר שאפשר לשלוח למשתמש.

---

## 5. אינטגרציה בפועל — מה באמת אפשרי

| שכבה | מסלול HF | זמין serverless? | איך קוראים מ‑KAIRO |
|---|---|---|---|
| חיזוי (Chronos‑2) | **Inference Endpoints (dedicated)** | ❌ **לא** | `POST` ל‑URL ייעודי, custom handler בפייתון |
| Embeddings (e5) | **Inference Providers** | ✅ כן | `POST https://router.huggingface.co/...` |
| Reranker (bge) | **Inference Providers / TEI** | ✅ כן | קריאת HTTP |
| LLM (gpt‑oss‑20b) | **Inference Providers** | ✅ כן | תואם OpenAI SDK |

### 5.1 למה זה בעצם מתאים ל‑KAIRO

ה‑stack שלכם הוא React + Vite + Node (`server.js`) + Supabase. Chronos‑2 הוא ספריית פייתון. **HF Inference Endpoint מבודד את הפייתון מחוץ ל‑repo שלכם** — אתם שולחים JSON, מקבלים JSON, ואף שורת פייתון לא נכנסת ל‑codebase. זה יתרון ארכיטקטוני אמיתי, לא רק נוחות.

### 5.2 העלות האמיתית

| רכיב | מפרט | עלות |
|---|---|---|
| Inference Endpoint ל‑Chronos‑2 | Intel Sapphire Rapids CPU, 4 vCPU / 8GB | **$0.13/שעה** |
| — always‑on | 24×7 | ≈ **$95/חודש** |
| — scale‑to‑zero | פעיל ~2 שעות/יום (batch לילי) | ≈ **$8/חודש** ⚠️ + cold start |
| Embeddings + LLM | Inference Providers, pay‑per‑use | קרדיטים ב‑HF PRO ($9/חודש) יכסו התחלה |
| Supabase | free tier | $0 |

**המלצה תפעולית:** אל תריצו את החיזוי בזמן אמת לכל חיפוש של משתמש. הריצו **batch לילי** על כל המסלולים הפעילים, שמרו את התחזיות ב‑Supabase, וה‑UI קורא מהטבלה. זה מוריד את העלות מ‑$95 ל‑~$8 בחודש, מסלק את בעיית ה‑cold start מהחוויה, והופך את האפליקציה למהירה יותר. מחירי טיסות לא זזים בקצב שמצדיק חיזוי בזמן אמת.

---

## 6. Roadmap מומלץ

| שלב | משך | מה עושים | תוצר |
|---|---|---|---|
| **0 — לוגינג** | שבוע 1 | טבלת `flight_price_snapshots` + cron יומי ל‑50 מסלולים | דאטה אמיתי מתחיל להצטבר. **הכי דחוף.** |
| **1 — Baseline** | שבועות 2–3 | Chronos‑2 zero‑shot על ההיסטוריה שנצברה, batch לילי, endpoint scale‑to‑zero | תחזית אמיתית ראשונה + q10/q50/q90 |
| **2 — Confidence** | שבוע 4 | מיפוי הקוונטילים ל‑BUY NOW / WAIT / HOLD, החלפת ההיוריסטיקה הקיימת | Buy‑timing מבוסס מודל |
| **3 — אירועים** | שבועות 5–7 | Ticketmaster + e5‑base + pgvector → `event_impact_score` כ‑covariate | הפיצ'ר המבדל |
| **4 — LLM** | שבוע 8 | gpt‑oss‑20b להסבר ההמלצה | UX מלוטש |
| **5 — Fine‑tune** | חודש 4+ | fine‑tune של Chronos‑2 על הדאטה הפרטי שלכם | דיוק שלא ניתן להעתקה |

---

## 7. תמצית ההחלטות

| שאלה | תשובה |
|---|---|
| איזה מודל חיזוי? | **`amazon/chronos-2`** — Apache‑2.0, covariates נייטיביים, קוונטילים, רץ על CPU |
| איך מריצים אותו? | **HF Inference Endpoint** (dedicated, CPU, scale‑to‑zero) — לא serverless, זה לא קיים ל‑time‑series |
| מאיפה הדאטה? | **מכם.** Cron יומי ל‑Supabase. HF ריק, Amadeus Self‑Service נסגר, Travelpayouts דורש 50K MAU |
| איזה embedding? | **`intfloat/multilingual-e5-base`** דרך HF Inference Providers |
| איזה LLM? | **`openai/gpt-oss-20b`** — אחרון בסדר העדיפויות |
| מה לא לעשות? | Moirai (CC‑BY‑NC = לא מסחרי), TiRex (רישיון עמום), ולא לבנות שום דבר על דאטה מסומלץ |
| כמה זה עולה? | **~$20–30/חודש** בקונפיגורציה batch לילי + HF PRO |

---

## נספח — הבדיקות שבוצעו

- `GET https://huggingface.co/api/models?pipeline_tag=time-series-forecasting&sort=downloads&limit=40` — 40 מודלים נסקרו
- `GET https://huggingface.co/api/models?inference_provider=all&pipeline_tag=time-series-forecasting` — **החזיר `[]`** (אימות שאין serverless ל‑time‑series)
- `GET https://huggingface.co/api/datasets?search=flight+price` — 2 תוצאות, שתיהן `n<1K`
- `GET https://huggingface.co/api/datasets?search=airfare` — **החזיר `[]`**
- `GET https://huggingface.co/api/datasets?search=airline&limit=40` — 40 תוצאות, כולן sentiment/reviews
- `GET https://huggingface.co/api/models?inference_provider=all&pipeline_tag=sentence-similarity` — אימות זמינות embeddings
- כרטיס המודל `amazon/chronos-2` נקרא במלואו לאימות תמיכה ב‑covariates
- דף התמחור של HF נקרא לאימות מחירי Inference Endpoints

**מקורות:**

- [amazon/chronos-2 — Hugging Face](https://huggingface.co/amazon/chronos-2)
- [Chronos-2 Technical Report (arXiv 2510.15821)](https://arxiv.org/abs/2510.15821)
- [Hugging Face Pricing](https://huggingface.co/pricing)
- [Building a flight price analysis model with machine learning — Amadeus for Developers](https://developers.amadeus.com/blog/flight-price-analysis-model-machine-learning)
- [Amadeus Self-Service APIs pricing](https://dev.developers.amadeus.com/pricing)
- [Amadeus API Pricing and Access: A Business Guide](https://oneclicktraveltech.com/blogs/amadeus-api-pricing-and-access)
- [Aviasales Data API — Travelpayouts Help Center](https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API)
- [10 Best Flight APIs in 2026: Free Tiers and Real Pricing](https://thunderbit.com/blog/best-flight-api-with-free-tiers)
