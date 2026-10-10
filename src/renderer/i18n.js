const LANG_KEY = "attendance.lang";
const FONT_KEY = "attendance.font";
const FONTS = ["cairo", "tajawal", "plex", "naskh"];

/** English source strings. Arabic is the only other language. Names are never keys. */
const AR = {
  Attendance: "الحضور",
  Settings: "الإعدادات",
  "Place a finger": "ضع إصبعاً",
  Listening: "يستمع",
  "One moment": "لحظة",
  "Place your finger": "ضع إصبعك",
  "Hold still": "ابقَ ثابتاً",
  Today: "اليوم",
  "Here today": "الحاضرون اليوم",
  "Loading the sheet": "جارٍ تحميل الكشف",
  "No one yet": "لا أحد بعد",
  Undo: "تراجع",
  "Last match": "آخر تطابق",
  Done: "تم",
  "New fingerprint": "بصمة جديدة",
  "Choose who this print belongs to.": "اختر صاحب هذه البصمة.",
  "Choose who this scan belongs to.": "اختر صاحب هذه المسحة.",
  Rescan: "أعد المسح",
  "Add more scans": "أضف مسحات",
  "Search students": "ابحث عن الطلاب",
  "Type a name": "اكتب اسماً",
  "No matching students": "لا طلاب مطابقين",
  "Service account path, spreadsheet, gid, and scanner.":
    "مسار حساب الخدمة، والجدول، والمعرّف، والماسح.",
  "Service account JSON": "ملف حساب الخدمة",
  Browse: "استعراض",
  "Spreadsheet id": "معرّف الجدول",
  "Sheet gid": "معرّف الورقة",
  "Prints are stored in": "البصمات محفوظة في",
  "Delete all fingerprints": "احذف كل البصمات",
  Save: "حفظ",
  Cancel: "إلغاء",
  "Drop these scans?": "إلغاء هذه المسحات؟",
  "These scans are dropped. No student is saved.": "تُلغى هذه المسحات. لا يُحفظ أي طالب.",
  "Drop scans": "أزل المسحات",
  "Close the app and open it again, then cancel.": "أغلق التطبيق وافتحه من جديد، ثم ألغِ.",
  Language: "اللغة",
  "Arabic font": "خط العربية",
  "Scanned finger": "الإصبع الممسوح",
  "Remove from today?": "إزالة من اليوم؟",
  "Today's cell is cleared. The time logged for today is removed. Other days stay.":
    "تُمسح خلية اليوم، ويُحذف وقت اليوم من السجل. بقية الأيام تبقى.",
  Remove: "إزالة",
  "Delete all fingerprints?": "حذف كل البصمات؟",
  "Prints on this computer and on the fingerprints sheet are removed. The attendance sheet is not changed.":
    "تُحذف البصمات من هذا الجهاز ومن ورقة البصمات. كشف الحضور لا يتغير.",
  "Delete fingerprints": "احذف البصمات",
  "Close the app and open it again, then undo.": "أغلق التطبيق وافتحه من جديد، ثم تراجع.",
  "Close the app and open it again, then change the time.": "أغلق التطبيق وافتحه من جديد، ثم غيّر الوقت.",
  "Close the app and open it again, then add more scans.": "أغلق التطبيق وافتحه من جديد، ثم أضف مسحات.",
  "Close the app and open it again, then delete the fingerprints.": "أغلق التطبيق وافتحه من جديد، ثم احذف البصمات.",
  Student: "طالب",
  "add scans": "إضافة مسحات",
  replace: "استبدال",
  "Waiting for a finger": "بانتظار إصبع",
  Waited: "انتظر",
  "Scanner ready": "الماسح جاهز",
  "Next scan": "المسح التالي",
  "Reading the finger": "يقرأ الإصبع",
  "Finger seen": "ظهر الإصبع",
  "Print saved": "حُفظت البصمة",
  "Picture saved": "حُفظت الصورة",
  Matched: "تطابق",
  "Not recognized": "غير معروفة",
  "No finger": "لا إصبع",
  "Took too long": "طال الانتظار",
  "Trying again": "محاولة أخرى",
  "Scanner not ready": "الماسح غير جاهز",
  Setup: "الإعداد",
  "Marked present.": "سُجّل حاضراً.",
  "Marked present. The time log was not written.": "سُجّل حاضراً. لم يُكتب سجل الوقت.",
  "Today's date column is missing, so the sheet was not changed.": "عمود تاريخ اليوم غير موجود، فلم يتغير الكشف.",
  "That id is on the sheet more than once, so no cell was changed.": "هذا المعرّف مكرر في الكشف، فلم تتغير أي خلية.",
  "That student has no id, so no cell was changed.": "هذا الطالب بلا معرّف، فلم تتغير أي خلية.",
  "That student is not on the sheet. No row was added.": "هذا الطالب غير موجود في الكشف. لم يُضف صف.",
  "The fingerprint sheet was not written.": "لم تُكتب ورقة البصمات.",
  "Marked present. The fingerprint sheet was not written.": "سُجّل حاضراً. لم تُكتب ورقة البصمات.",
  "Marked present. The time log was not written. The fingerprint sheet was not written.":
    "سُجّل حاضراً. لم يُكتب سجل الوقت. لم تُكتب ورقة البصمات.",
  "Saved on this computer. The fingerprint sheet was not written.": "حُفظ على هذا الجهاز. لم تُكتب ورقة البصمات.",
  "The scanner is having trouble. Still listening.": "الماسح يواجه مشكلة. ما زال يستمع.",
  "Syncing templates…": "جارٍ مزامنة القوالب…",
  "Syncing…": "جارٍ المزامنة…",
  "Loading students…": "جارٍ تحميل الطلاب…",
  "No students on the sheet yet. Add them in Google Sheets. This print is kept.":
    "لا طلاب في الكشف بعد. أضفهم في جداول غوغل. هذه البصمة محفوظة.",
  "Saving these scans…": "جارٍ حفظ هذه المسحات…",
  "Saving this print…": "جارٍ حفظ هذه البصمة…",
  "Saved on this computer.": "حُفظ على هذا الجهاز.",
  "All fingerprints deleted.": "حُذفت كل البصمات.",
  "The fingerprint sheet is not available.": "ورقة البصمات غير متاحة.",
  "The sheet is not available.": "الكشف غير متاح.",
  "Enter a time like 16:55.": "أدخل وقتاً مثل 16:55.",
  "No time log sheet is configured.": "لم يُضبط جدول سجل الوقت.",
  "The app is still starting.": "التطبيق ما زال يبدأ.",
  "Choose a student from the list.": "اختر طالباً من القائمة.",
  "No fingerprint is waiting.": "لا بصمة بانتظار الربط.",
  "The saved print is empty.": "البصمة المحفوظة فارغة.",
  "Service account must be a file path, not the key itself.": "حساب الخدمة يجب أن يكون مسار ملف، لا المفتاح نفسه.",
  "Sheet gid must be a number.": "معرّف الورقة يجب أن يكون رقماً.",
  "Today's date column is missing.": "عمود تاريخ اليوم غير موجود.",
  "That student is not on the sheet.": "هذا الطالب غير موجود في الكشف.",
  "The time log row no longer matches, so it was left.": "صف سجل الوقت لم يعد مطابقاً، فتُرك كما هو.",
  "The time log was not changed.": "لم يتغير سجل الوقت.",
  "Scanner did not run.": "لم يعمل الماسح.",
  "That cell is in a protected range, so the sheet was not changed.": "هذه الخلية في نطاق محمي، فلم يتغير الكشف.",
  "Sheet permission denied.": "لا إذن على الكشف.",
};

const MATCH_TAILS = Object.keys(AR)
  .filter((key) => key.length > 12)
  .sort((a, b) => b.length - a.length);

function ltr(value) {
  return `\u2066${value}\u2069`;
}

function scans(n) {
  const count = Number(n);
  if (count === 1) return "مسحة واحدة";
  if (count === 2) return "مسحتان";
  if (count >= 3 && count <= 10) return `${count} مسحات`;
  return `${count} مسحة`;
}

function pattern(value) {
  let match = value.match(/^(\d+) scans? kept\. Place another finger\.$/);
  if (match) return `حُفظت ${scans(match[1])}. ضع إصبعاً آخر.`;

  match = value.match(/^Choose who these (\d+) scans belong to\.$/);
  if (match) {
    const count = Number(match[1]);
    if (count === 2) return "اختر صاحب هاتين المسحتين.";
    return `اختر صاحب هذه المسحات (${count}).`;
  }

  match = value.match(/^Done · (\d+) scans?$/);
  if (match) return `تم · ${scans(match[1])}`;

  match = value.match(/^Scanner CLI not found at (.+)$/);
  if (match) return `لم يُعثر على الماسح في ${ltr(match[1])}`;

  match = value.match(/^Synced (.+)$/);
  if (match) return `تمت المزامنة ${ltr(match[1])}`;

  match = value.match(/^Saved (\d+) scans?\. (.+)$/);
  if (match) return `حُفظت ${scans(match[1])}. ${translate(match[2], "ar")}`;

  match = value.match(/^Linked (.+?)\. (.+)$/);
  if (match) return `رُبطت بـ ${match[1]}. ${translate(match[2], "ar")}`;

  match = value.match(/^Time for (.+) set to (.+)\.$/);
  if (match) return `وقت ${match[1]} أصبح ${ltr(match[2])}.`;

  match = value.match(/^Time for (.+)$/);
  if (match) return `وقت ${match[1]}`;

  match = value.match(/^(.+) removed from today\.(.*)$/);
  if (match) {
    const note = match[2].trim();
    const line = `أُزيل ${match[1]} من اليوم.`;
    return note ? `${line} ${translate(note, "ar")}` : line;
  }

  match = value.match(/^Can't load students from the sheet: (.+)$/);
  if (match) return `تعذر تحميل الطلاب من الكشف: ${translate(match[1], "ar")}`;

  match = value.match(/^Sheet permission denied\. Share as Editor with (.+)$/);
  if (match) return `لا إذن على الكشف. شارك كمحرر مع ${ltr(match[1])}`;

  if (value.startsWith("Matched ")) {
    const rest = value.slice("Matched ".length);
    for (const tail of MATCH_TAILS) {
      if (rest.endsWith(tail) && rest.length > tail.length) {
        const name = rest.slice(0, rest.length - tail.length).trim();
        if (name) return `${AR.Matched} ${name} ${AR[tail]}`;
      }
    }
    return `${AR.Matched} ${rest}`;
  }

  return "";
}

export function currentLang() {
  try {
    return localStorage.getItem(LANG_KEY) === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

/** Translate one visible string. Unknown text, including student names, is returned as given. */
export function translate(text, lang = currentLang()) {
  const value = String(text ?? "");
  if (!value || lang !== "ar") return value;
  if (Object.prototype.hasOwnProperty.call(AR, value)) return AR[value];
  return pattern(value) || value;
}

export function applyDom() {
  const lang = currentLang();
  document.documentElement.lang = lang === "ar" ? "ar" : "en";
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = translate(el.getAttribute("data-i18n"), lang);
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    el.placeholder = translate(el.getAttribute("data-i18n-placeholder"), lang);
  }
  for (const el of document.querySelectorAll("[data-i18n-aria]")) {
    el.setAttribute("aria-label", translate(el.getAttribute("data-i18n-aria"), lang));
  }
  for (const el of document.querySelectorAll("[data-i18n-alt]")) {
    el.alt = translate(el.getAttribute("data-i18n-alt"), lang);
  }
  for (const button of document.querySelectorAll("[data-lang]")) {
    button.setAttribute("aria-pressed", button.dataset.lang === lang ? "true" : "false");
  }
  applyFont();
}

export function currentFont() {
  try {
    const id = localStorage.getItem(FONT_KEY);
    if (FONTS.includes(id)) return id;
  } catch {
    /* keep the default */
  }
  return "cairo";
}

export function applyFont() {
  const id = currentFont();
  document.documentElement.dataset.font = id;
  for (const button of document.querySelectorAll("[data-font]")) {
    button.setAttribute("aria-pressed", button.dataset.font === id ? "true" : "false");
  }
}

export function setFont(id) {
  const next = FONTS.includes(id) ? id : "cairo";
  try {
    localStorage.setItem(FONT_KEY, next);
  } catch {
    /* the choice still applies for this view */
  }
  applyFont();
  return next;
}

export function setLang(lang) {
  const next = lang === "ar" ? "ar" : "en";
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    /* the choice still applies for this view */
  }
  applyDom();
  return next;
}
