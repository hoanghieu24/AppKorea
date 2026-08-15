import { useEffect, useMemo, useState } from 'react';
import { Bot, KeyRound, Megaphone, Radio, Save, Settings2, Sparkles, SunMoon, Volume2, Wifi } from 'lucide-react';
import { api } from '../api.js';
import { PageHeader } from '../components/Shell.jsx';

const MODELS = [
  ['gemini-2.5-flash', 'Gemini 2.5 Flash · ổn định, nhanh'],
  ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite · tiết kiệm'],
  ['gemini-2.5-pro', 'Gemini 2.5 Pro · chấm bài sâu hơn'],
  ['gemini-3.5-flash', 'Gemini 3.5 Flash'],
  ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite'],
  ['gemini-3.6-flash', 'Gemini 3.6 Flash'],
];

const defaults = {
  geminiModel: 'gemini-2.5-flash',
  speechRate: 0.8,
  speechPitch: 1,
  voiceMode: 'online',
  voiceName: '',
  personality: 'hana',
  theme: 'light',
  aiConfigured: false,
  apiKeyMasked: '',
  announcementText: '',
  announcementEnabled: false,
};

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState(defaults);
  const [apiKey, setApiKey] = useState('');
  const [voices, setVoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api('/admin/settings').then(({ settings: data }) => setSettings({ ...defaults, ...data })).catch((err) => setMessage(err.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!window.speechSynthesis) return undefined;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices().filter((voice) => voice.lang?.toLowerCase().replace('_', '-').startsWith('ko')));
    loadVoices(); window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', loadVoices);
  }, []);

  const payload = useMemo(() => ({
    apiKey,
    geminiModel: settings.geminiModel,
    speechRate: Number(settings.speechRate),
    speechPitch: Number(settings.speechPitch),
    voiceMode: settings.voiceMode,
    voiceName: settings.voiceName || '',
    personality: settings.personality,
    theme: settings.theme,
    announcementText: settings.announcementText || '',
    announcementEnabled: Boolean(settings.announcementEnabled),
  }), [apiKey, settings]);

  const save = async (event) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const data = await api('/admin/settings', { method: 'PUT', body: JSON.stringify(payload) });
      setSettings({ ...defaults, ...data.settings });
      setApiKey('');
      setMessage('Cấu hình và thông báo toàn trang đã được lưu & áp dụng ngay cho tất cả người dùng!');
      // Dispatch custom event để Shell cập nhật ngay lập tức nếu đang mở
      window.dispatchEvent(new CustomEvent('app-announcement-updated'));
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };

  const testAi = async () => {
    setBusy(true); setMessage('Đang thử kết nối Gemini...');
    try {
      const data = await api('/admin/settings/ai/test', { method: 'POST', body: JSON.stringify({ apiKey, geminiModel: settings.geminiModel }) });
      setMessage(data.message);
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };

  const clearKey = async () => {
    if (!window.confirm('Xóa Gemini API key đang lưu trên hệ thống?')) return;
    setBusy(true);
    try {
      const data = await api('/admin/settings', { method: 'PUT', body: JSON.stringify({ ...payload, apiKey: '', clearApiKey: true }) });
      setSettings({ ...defaults, ...data.settings }); setApiKey('');
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };

  const testVoice = () => {
    if (!window.speechSynthesis) return setMessage('Trình duyệt này không hỗ trợ Web Speech.');
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance('안녕하세요! 한국어 공부를 시작해요.');
    utterance.lang = 'ko-KR'; utterance.rate = Number(settings.speechRate); utterance.pitch = Number(settings.speechPitch);
    if (settings.voiceName) utterance.voice = voices.find((voice) => voice.name === settings.voiceName) || null;
    window.speechSynthesis.speak(utterance);
  };

  if (loading) return <section className="panel"><p>Đang tải cấu hình...</p></section>;
  return <>
    <PageHeader eyebrow="ADMIN · HỆ THỐNG" title="Cấu hình & Thông báo toàn trang" subtitle="Quản lý kết nối Gemini AI, giọng đọc tiếng Hàn và thông báo khẩn cấp/bảo trì chạy trên web." />
    {message && <div className="notice">{message}</div>}
    <form onSubmit={save} className="settings-admin-grid">
      {/* SECTION THÔNG BÁO TOÀN TRANG (CHẠY TRÊN WEB) */}
      <section className="panel settings-card span-settings announcement-settings-card">
        <div className="settings-card-head">
          <div className="settings-card-icon orange"><Megaphone /></div>
          <div>
            <span>THÔNG BÁO CHẠY TRÊN WEB</span>
            <h3>Thông báo hệ thống &amp; Bảo trì</h3>
          </div>
          <label className="toggle-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginLeft: 'auto' }}>
            <input
              type="checkbox"
              checked={settings.announcementEnabled}
              onChange={(e) => setSettings({ ...settings, announcementEnabled: e.target.checked })}
              style={{ width: 18, height: 18, accentColor: 'var(--purple)' }}
            />
            <strong style={{ fontSize: '.88rem', color: settings.announcementEnabled ? '#4338ca' : '#6b7280' }}>
              {settings.announcementEnabled ? '🟢 Đang BẬT chạy trên web' : '⚪ Đang TẮT'}
            </strong>
          </label>
        </div>

        <label style={{ display: 'grid', gap: 6, marginTop: 4 }}>
          <span>Nội dung thông báo (Hiển thị chạy chữ trên đầu website cho tất cả mọi người):</span>
          <textarea
            rows="3"
            value={settings.announcementText}
            onChange={(e) => setSettings({ ...settings, announcementText: e.target.value })}
            placeholder="Ví dụ: 📢 Website sẽ bảo trì trong 15 phút nữa. Quý học sinh và giáo viên vui lòng lưu lại bài tập và quay lại sau ít phút nhé!"
            style={{ width: '100%', borderRadius: 10, padding: 10, border: '1px solid var(--line)', fontSize: '.88rem', fontFamily: 'inherit' }}
          />
        </label>

        {settings.announcementText && (
          <div style={{ marginTop: 8 }}>
            <small style={{ color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Xem trước thông báo trên giao diện người dùng:</small>
            <div className="announcement-marquee-preview">
              <div className="announcement-marquee-content">
                <Megaphone size={16} style={{ display: 'inline', marginRight: 8, verticalAlign: '-2px' }} />
                <strong>{settings.announcementText}</strong>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* SECTION GEMINI AI */}
      <section className="panel settings-card ai-settings-card">
        <div className="settings-card-head"><div className="settings-card-icon purple"><Bot /></div><div><span>GEMINI AI</span><h3>Kết nối & mô hình</h3></div><b className={settings.aiConfigured ? 'config-ok' : 'config-off'}>{settings.aiConfigured ? 'Đã kết nối key' : 'Chưa có key'}</b></div>
        <label>Gemini API Key<div className="secret-input"><KeyRound size={17} /><input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={settings.apiKeyMasked || 'AIza...'} autoComplete="new-password" /></div><small>{settings.apiKeyMasked ? `Key hiện tại: ${settings.apiKeyMasked} · để trống nếu không đổi.` : 'Key chỉ được lưu ở backend và không gửi xuống tài khoản học sinh/giáo viên.'}</small></label>
        <label>Mô hình<select value={settings.geminiModel} onChange={(e) => setSettings({ ...settings, geminiModel: e.target.value })}>{MODELS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <div className="settings-actions"><button type="button" className="btn secondary" onClick={testAi} disabled={busy}><Wifi size={17} /> Thử kết nối</button>{settings.aiConfigured && <button type="button" className="btn ghost danger-text" onClick={clearKey} disabled={busy}>Xóa key</button>}</div>
      </section>

      {/* SECTION GIỌNG ĐỌC */}
      <section className="panel settings-card">
        <div className="settings-card-head"><div className="settings-card-icon green"><Volume2 /></div><div><span>GIỌNG ĐỌC</span><h3>Tiếng Hàn</h3></div></div>
        <label>Chế độ giọng<select value={settings.voiceMode} onChange={(e) => setSettings({ ...settings, voiceMode: e.target.value })}><option value="online">Giọng Hàn HD / Online (Google TTS)</option><option value="local">Giọng có trên thiết bị</option></select></label>
        {settings.voiceMode === 'local' && <label>Giọng Korean<select value={settings.voiceName} onChange={(e) => setSettings({ ...settings, voiceName: e.target.value })}><option value="">Tự chọn giọng tốt nhất</option>{voices.map((voice) => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name} ({voice.lang})</option>)}</select></label>}
        <label className="range-setting"><span>Tốc độ <b>{Number(settings.speechRate).toFixed(1)}</b></span><input type="range" min="0.5" max="1.5" step="0.1" value={settings.speechRate} onChange={(e) => setSettings({ ...settings, speechRate: e.target.value })} /></label>
        <label className="range-setting"><span>Cao độ <b>{Number(settings.speechPitch).toFixed(1)}</b></span><input type="range" min="0.5" max="2" step="0.1" value={settings.speechPitch} onChange={(e) => setSettings({ ...settings, speechPitch: e.target.value })} /></label>
        <button type="button" className="btn ghost" onClick={testVoice}><Volume2 size={17} /> Thử giọng: 안녕하세요!</button>
      </section>

      {/* SECTION PHÒNG TỰ HỌC */}
      <section className="panel settings-card span-settings">
        <div className="settings-card-head"><div className="settings-card-icon orange"><Settings2 /></div><div><span>PHÒNG TỰ HỌC</span><h3>Gia sư & giao diện mặc định</h3></div></div>
        <div className="personality-admin-grid">
          {[['hana', '👩‍🏫', 'Hana', 'Ân cần, kiên nhẫn'], ['minho', '👨‍💼', 'Minho', 'Nghiêm túc, chuyên nghiệp'], ['yuri', '👧', 'Yuri', 'Vui vẻ, dễ gần']].map(([value, emoji, name, note]) => <button type="button" key={value} className={settings.personality === value ? 'personality-admin active' : 'personality-admin'} onClick={() => setSettings({ ...settings, personality: value })}><span>{emoji}</span><strong>{name}</strong><small>{note}</small></button>)}
        </div>
        <div className="theme-setting"><SunMoon size={19} /><div><strong>Giao diện Phòng tự học</strong><span>Đồng bộ cho mọi tài khoản khi mở Phòng tự học.</span></div><select value={settings.theme} onChange={(e) => setSettings({ ...settings, theme: e.target.value })}><option value="light">Sáng · Classroom</option><option value="dark">Tối</option></select></div>
      </section>

      <div className="settings-save-bar"><div><strong>Chỉ Admin thay đổi được</strong><span>Mọi thay đổi về thông báo hay cấu hình AI sẽ áp dụng tức thì cho toàn bộ người dùng.</span></div><button className="btn primary" disabled={busy}><Save size={17} /> {busy ? 'Đang lưu...' : 'Lưu & áp dụng'}</button></div>
    </form>
  </>;
}
