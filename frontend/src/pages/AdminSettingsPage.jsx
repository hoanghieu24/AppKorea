import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Bot, KeyRound, Megaphone, RefreshCw, Save, Settings2, SunMoon, Volume2, Wifi } from 'lucide-react';
import { api } from '../api.js';
import { PageHeader } from '../components/Shell.jsx';

const MODELS = [
  ['gemini-3.7-flash', 'Gemini 3.7 Flash · mới, mạnh và nhanh'],
  ['gemini-3.6-flash', 'Gemini 3.6 Flash · mạnh, cân bằng'],
  ['gemini-3.5-flash', 'Gemini 3.5 Flash · ổn định, tốc độ cao'],
  ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite · tiết kiệm, tải cao'],
  ['gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite · nhẹ, chi phí thấp'],
  ['gemini-2.5-flash', 'Gemini 2.5 Flash · tương thích tốt'],
  ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite · tiết kiệm'],
  ['gemini-2.5-pro', 'Gemini 2.5 Pro · chấm bài sâu hơn'],
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
  apiKeyCount: 0,
  apiKeys: [],
  announcementText: '',
  announcementEnabled: false,
};

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState(defaults);
  const [apiKeysText, setApiKeysText] = useState('');
  const [voices, setVoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [monitoring, setMonitoring] = useState({ totals: {}, users: [], keys: [], errors: [] });
  const [monitoringBusy, setMonitoringBusy] = useState(false);

  const loadMonitoring = async () => {
    setMonitoringBusy(true);
    try {
      const [aiData, errorData] = await Promise.all([
        api('/admin/monitoring/ai?days=1'),
        api('/admin/monitoring/errors?limit=15'),
      ]);
      setMonitoring({
        totals: aiData.totals || {},
        users: aiData.users || [],
        keys: aiData.keys || [],
        errors: errorData.errors || [],
      });
    } catch (err) {
      setMessage((current) => current || err.message);
    } finally {
      setMonitoringBusy(false);
    }
  };

  useEffect(() => {
    Promise.all([
      api('/admin/settings').then(({ settings: data }) => setSettings({ ...defaults, ...data })),
      loadMonitoring(),
    ]).catch((err) => setMessage(err.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!window.speechSynthesis) return undefined;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices().filter((voice) => voice.lang?.toLowerCase().replace('_', '-').startsWith('ko')));
    loadVoices(); window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', loadVoices);
  }, []);

  const payload = useMemo(() => ({
    apiKey: '',
    apiKeysText: '',
    geminiModel: settings.geminiModel,
    speechRate: Number(settings.speechRate),
    speechPitch: Number(settings.speechPitch),
    voiceMode: settings.voiceMode,
    voiceName: settings.voiceName || '',
    personality: settings.personality,
    theme: settings.theme,
    announcementText: settings.announcementText || '',
    announcementEnabled: Boolean(settings.announcementEnabled),
  }), [settings]);

  const save = async (event) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const data = await api('/admin/settings', { method: 'PUT', body: JSON.stringify(payload) });
      setSettings({ ...defaults, ...data.settings });
      setMessage('Cấu hình và thông báo toàn trang đã được lưu & áp dụng ngay cho tất cả người dùng!');
      // Dispatch custom event để Shell cập nhật ngay lập tức nếu đang mở
      window.dispatchEvent(new CustomEvent('app-announcement-updated'));
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };

  const addAiKeys = async () => {
    const text = apiKeysText.trim();
    if (!text) return setMessage('Hãy dán ít nhất 1 Gemini API key.');
    setBusy(true); setMessage('Đang thêm API key...');
    try {
      const data = await api('/admin/settings/ai/keys', { method: 'POST', body: JSON.stringify({ apiKeysText: text }) });
      setSettings({ ...defaults, ...data.settings });
      setApiKeysText('');
      setMessage(data.message);
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };

  const testAi = async (keyId = null) => {
    setBusy(true); setMessage('Đang thử kết nối Gemini...');
    try {
      const unsavedKey = !keyId ? apiKeysText.split(/[\n,;]+/).map((item) => item.trim()).find(Boolean) || '' : '';
      const data = await api('/admin/settings/ai/test', {
        method: 'POST',
        body: JSON.stringify({ apiKey: unsavedKey, keyId: keyId || undefined, geminiModel: settings.geminiModel }),
      });
      setMessage(data.message);
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };

  const toggleAiKey = async (key) => {
    if (!key.managed || !key.id) return;
    setBusy(true);
    try {
      const data = await api(`/admin/settings/ai/keys/${key.id}`, { method: 'PATCH', body: JSON.stringify({ active: !key.active }) });
      setSettings({ ...defaults, ...data.settings });
      setMessage(data.message);
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };

  const deleteAiKey = async (key) => {
    if (!key.managed || !key.id) return;
    if (!window.confirm(`Xóa ${key.label} khỏi pool Gemini?`)) return;
    setBusy(true);
    try {
      const data = await api(`/admin/settings/ai/keys/${key.id}`, { method: 'DELETE' });
      setSettings({ ...defaults, ...data.settings });
      setMessage(data.message);
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };

  const clearKey = async () => {
    if (!window.confirm('Xóa toàn bộ Gemini API key đang lưu trong database? Key đặt bằng ENV sẽ không bị xóa.')) return;
    setBusy(true);
    try {
      const data = await api('/admin/settings', { method: 'PUT', body: JSON.stringify({ ...payload, clearApiKey: true }) });
      setSettings({ ...defaults, ...data.settings }); setApiKeysText('');
      setMessage('Đã xóa các API key do Admin lưu trong database.');
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
        <div className="settings-card-head"><div className="settings-card-icon purple"><Bot /></div><div><span>GEMINI AI</span><h3>Pool API & failover</h3></div><b className={settings.aiConfigured ? 'config-ok' : 'config-off'}>{settings.aiConfigured ? `${settings.apiKeyCount || settings.apiKeys?.length || 0} key khả dụng` : 'Chưa có key'}</b></div>
        <label>Mô hình<select value={settings.geminiModel} onChange={(e) => setSettings({ ...settings, geminiModel: e.target.value })}>{MODELS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>Thêm API key (mỗi key một dòng)
          <div className="secret-input" style={{ alignItems: 'flex-start' }}><KeyRound size={17} style={{ marginTop: 10 }} /><textarea rows="4" value={apiKeysText} onChange={(e) => setApiKeysText(e.target.value)} placeholder={'AIza...\nAIza...\nAIza...'} autoComplete="off" style={{ width: '100%', resize: 'vertical', border: 0, outline: 0, background: 'transparent', fontFamily: 'inherit' }} /></div>
          <small>Key được mã hóa AES-256-GCM trong MySQL. Học sinh/giáo viên không nhận được key. Backend tự cooldown và chuyển key khi 429/503/timeout/lỗi key.</small>
        </label>
        <div className="settings-actions"><button type="button" className="btn secondary" onClick={addAiKeys} disabled={busy || !apiKeysText.trim()}><KeyRound size={17} /> Thêm vào pool</button><button type="button" className="btn secondary" onClick={() => testAi()} disabled={busy || (!apiKeysText.trim() && !settings.aiConfigured)}><Wifi size={17} /> Thử kết nối</button>{settings.apiKeys?.some((key) => key.managed) && <button type="button" className="btn ghost danger-text" onClick={clearKey} disabled={busy}>Xóa key DB</button>}</div>

        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          {(settings.apiKeys || []).map((key, index) => <div key={`${key.source}-${key.id || index}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10 }}>
            <div style={{ minWidth: 0 }}><strong style={{ display: 'block' }}>{key.label} · {key.masked}</strong><small style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{key.active ? '🟢' : '⚪'} {key.status || 'READY'}{key.cooldownUntil ? ` · cooldown tới ${new Date(key.cooldownUntil).toLocaleTimeString('vi-VN')}` : ''}{key.failureCount ? ` · lỗi ${key.failureCount} lần` : ''}</small></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button type="button" className="btn ghost small" onClick={() => testAi(key.id)} disabled={busy || !key.managed}>Test</button>
              {key.managed && <button type="button" className="btn ghost small" onClick={() => toggleAiKey(key)} disabled={busy}>{key.active ? 'Tắt' : 'Bật'}</button>}
              {key.managed && <button type="button" className="btn ghost small danger-text" onClick={() => deleteAiKey(key)} disabled={busy}>Xóa</button>}
            </div>
          </div>)}
          {!settings.apiKeys?.length && <small>Chưa có API key nào trong pool.</small>}
        </div>
      </section>

      {/* SECTION MONITORING */}
      <section className="panel settings-card span-settings">
        <div className="settings-card-head">
          <div className="settings-card-icon green"><Activity /></div>
          <div><span>GIÁM SÁT PRODUCTION</span><h3>AI & lỗi hệ thống hôm nay</h3></div>
          <button type="button" className="btn ghost" onClick={loadMonitoring} disabled={monitoringBusy} style={{ marginLeft: 'auto' }}><RefreshCw size={16} /> {monitoringBusy ? 'Đang tải...' : 'Làm mới'}</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 10, marginBottom: 12 }}>
          {[
            ['Lượt gọi Gemini thật', Number(monitoring.totals.requests || 0).toLocaleString('vi-VN')],
            ['Thành công', Number(monitoring.totals.successCount || 0).toLocaleString('vi-VN')],
            ['429 / rate limit', Number(monitoring.totals.rateLimitedCount || 0).toLocaleString('vi-VN')],
            ['503 / unavailable', Number(monitoring.totals.unavailableCount || 0).toLocaleString('vi-VN')],
            ['Độ trễ TB', `${Number(monitoring.totals.averageLatencyMs || 0).toLocaleString('vi-VN')} ms`],
          ].map(([label, value]) => <div key={label} style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 12 }}><small>{label}</small><strong style={{ display: 'block', fontSize: '1.15rem', marginTop: 4 }}>{value}</strong></div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
            <strong>Người dùng AI nhiều nhất</strong>
            <div style={{ display: 'grid', gap: 7, marginTop: 9 }}>
              {monitoring.users.slice(0, 5).map((user) => <div key={user.id || user.email || user.fullName} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.fullName || user.email || 'Không xác định'}</span><b>{Number(user.requestCount || 0)}</b></div>)}
              {!monitoring.users.length && <small>Chưa có request AI nào hôm nay.</small>}
            </div>
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
            <strong><AlertTriangle size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />Lỗi hệ thống gần nhất</strong>
            <div style={{ display: 'grid', gap: 7, marginTop: 9 }}>
              {monitoring.errors.slice(0, 5).map((error) => <div key={error.id} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 6 }}><small style={{ display: 'block' }}>{error.statusCode || 500} · {error.method} {error.path}</small><span style={{ fontSize: '.82rem' }}>{error.message}</span></div>)}
              {!monitoring.errors.length && <small>Chưa ghi nhận lỗi backend gần đây.</small>}
            </div>
          </div>
        </div>
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
