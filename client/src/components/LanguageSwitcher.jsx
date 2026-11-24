import { useState } from 'react';
import { useLanguage, setLanguage, languageLocale } from '../services/language';
import { api } from '../services/api';
import { useSession } from '../services/session';

export default function LanguageSwitcher() {
  const language = useLanguage();
  const { user, setUser } = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  return <div className="language-control">
    <select aria-label={language === 'fa-AF' ? 'زبان رابط' : 'Interface language'} value={language} disabled={pending}
      onChange={async event => {
        const next = event.target.value;
        setError(false);
        if (!user) { setLanguage(next); return; }
        setPending(true);
        try {
          const updated = await api('/me', { method: 'PATCH', data: { locale: languageLocale(next) } });
          setLanguage(next);
          setUser(updated);
        } catch { setError(true); }
        finally { setPending(false); }
      }}>
      <option value="en" lang="en">English</option>
      <option value="fa-AF" lang="fa-AF">دری</option>
    </select>
    {error && <small role="alert">{language === 'fa-AF' ? 'ذخیرهٔ زبان انجام نشد. دوباره تلاش کنید.' : 'Could not save language. Try again.'}</small>}
  </div>;
}
