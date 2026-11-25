// Guide: capabilities, models, references.
import { h, card, note } from '../ui/dom.js';
export default {
  id: 'about', title: 'راهنما و مراجع', icon: '📚', group: 'داده',
  render(el) {
    const items = [
      ['پخش بار AC', 'نیوتن-رافسون قطبی با ژاکوبین کامل، Fast-Decoupled (XB)، گوس-سایدل شتاب‌دار؛ مدل π خطوط، تپ غیرنامی و جابجاگر فاز؛ اعمال حد Q با تبدیل PV→PQ.'],
      ['پخش بار DC و حساسیت‌ها', 'PTDF و LODF برای غربالگری سریع پیشامد.'],
      ['دیسپاچ و بازار', 'λ-iteration با/بدون تلفات ضرایب B، تعهد واحد فهرست اولویت ۲۴ ساعته، DC-OPF با حل‌کننده نقطه درونی و قیمت گرهی (LMP) با تفکیک ازدحام.'],
      ['اتصال کوتاه', 'روش Zbus با شبکه‌های توالی مثبت/منفی/صفر؛ خطاهای 3φ، SLG، LL، DLG با امپدانس خطا؛ سطح اتصال کوتاه، X/R و ضریب κ (IEC 60909).'],
      ['پایداری گذرا', 'مدل کلاسیک چندماشینه، کاهش Kron، RK4، خطای سه‌فاز با قطع خط و جست‌وجوی دوبخشی CCT؛ SMIB و معیار سطوح برابر.'],
      ['سیگنال کوچک', 'ماتریس حالت، مقادیر ویژه با QR فرانسیس، بردار ویژه با تکرار معکوس، شکل مد و ضرایب مشارکت؛ دسته‌بندی مدهای محلی/بین‌ناحیه‌ای.'],
      ['پایداری ولتاژ', 'منحنی‌های PV و QV، شاخص L، تحلیل مدال Q–V ژاکوبین کاهش‌یافته.'],
      ['امنیت', 'تحلیل پیشامد N-1 کامل AC (خطوط و ژنراتورها) با شاخص عملکرد و شناسایی جزیره‌سازی.'],
      ['توزیع', 'BFS برای فیدر شعاعی، شاخص VSI، جانمایی بهینه DG و خازن.'],
      ['فرکانس', 'LFC یک/دو ناحیه‌ای با گاورنر، توربین (بازگرمایش)، AGC، خط ارتباطی و اینرسی مجازی باتری.'],
      ['قابلیت اطمینان', 'COPT، LOLE، EENS، LOLP؛ SAIFI/SAIDI/CAIDI/ASAI.'],
      ['حفاظت', 'هماهنگی رله‌های IDMT (IEC/IEEE)، رله دیستانس مهو، رله دیفرانسیل دوشیبه.'],
      ['تجهیزات', 'پارامتر خط از هندسه (GMD/GMR، باندل)، ABCD خط بلند/π/کوتاه، SIL و فرانتی؛ ترانسفورماتور، موتور القایی، نمودار توانایی ژنراتور سنکرون؛ هارمونیک و اصلاح ضریب توان.'],
      ['ابزار پژوهشی', 'حل‌کننده اسپارس، دینامیک دقیق (ماشین دومحوره، AVR، PSS، گاورنر، اینورتر GFL)، AC-OPF، SCOPF، UC با آزادسازی لاگرانژ، پخش بار احتمالاتی، IEC 60909، ورود/خروج PSS/E و کنسول اسکریپت.'],
      ['سه‌بعدی (three.js)', 'مدارساز سه‌بعدی با فیزیک واقعی (دمای قطعات، سوختن و آتش‌سوزی، کد رنگ مقاومت، رنگ نور لامپ). شبکه سه‌بعدی تعاملی با قوس و آتش در محل خطا، با ارتفاع ولتاژ/زاویه، ذرات جریان توان، سطح ولتاژ، نمایش خطا، پخش دینامیک گذرا، انیمیشن شکل مدها، نقشه LMP؛ برج و کریدور خط انتقال؛ میدان مغناطیسی دوار.'],
    ];
    el.append(card('قابلیت‌ها', h('div', { class: 'feature-grid' }, items.map(([t, d]) => h('div', { class: 'feature' }, h('h4', {}, t), h('p', {}, d))))));
    el.append(card('شبکه‌های آماده', h('ul', {}, h('li', {}, 'WSCC 9 باس، ۳ ماشین (Anderson & Fouad)'), h('li', {}, 'IEEE 14 باس'), h('li', {}, 'IEEE 39 باس New England (۱۰ ماشین) — داده‌های MATPOWER و پارامترهای دینامیکی Pai'), h('li', {}, 'IEEE 33 باس توزیع (Baran & Wu)'), h('li', {}, 'هر فایل MATPOWER دلخواه از طریق ویرایشگر'))));
    el.append(card('مراجع', h('ul', {}, ['Kundur, Power System Stability and Control', 'Grainger & Stevenson, Power System Analysis', 'Saadat, Power System Analysis', 'Anderson & Fouad, Power System Control and Stability', 'Wood, Wollenberg & Sheblé, Power Generation, Operation and Control', 'Billinton & Allan, Reliability Evaluation of Power Systems', 'Zimmerman et al., MATPOWER (IEEE Trans. Power Syst. 2011)', 'Baran & Wu, IEEE Trans. Power Delivery 1989', 'Kessel & Glavitsch, IEEE Trans. Power Delivery 1986'].map((r) => h('li', {}, r)))));
    el.append(note('همه محاسبات در مرورگر و بدون سرور انجام می‌شوند. موتورهای عددی مستقل از رابط کاربری‌اند و با Node تست می‌شوند (npm test).'));
  },
};
