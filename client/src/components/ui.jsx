import { t, useLanguage } from '../services/language';
import { Link } from 'react-router-dom';
import { AlertCircle, LoaderCircle } from 'lucide-react';

export function Button({ to, variant = 'primary', className = '', ...props }) {
  useLanguage();
  const classes = 'button ' + variant + ' ' + className;
  return to ? <Link to={to} className={classes} {...props} children={t(props.children)} /> : <button type="button" className={classes} {...props} children={t(props.children)} />;
}

export function Input({ name, label, error, action, 'aria-describedby': describedBy, ...props }) {
  useLanguage();
  return <div className="field">
    <label htmlFor={name}>{t(label)}</label>
    <div className="input-wrap">
      <input id={name} name={name} dir={['email','url','password','tel','number','date','time','datetime-local','color'].includes(props.type) ? 'ltr' : 'auto'} aria-invalid={Boolean(error)} aria-describedby={[describedBy, error && name + '-error'].filter(Boolean).join(' ') || undefined} {...props} />
      {t(action)}
    </div>
    {error && <small id={name + '-error'}>{t(error)}</small>}
  </div>;
}

export function Card({ children, className = '' }) {
  useLanguage();
  return <section className={'card ' + className}>{t(children)}</section>;
}

export function PageHeader({ title, description, children }) {
  useLanguage();
  return <div className="page-heading"><div><h1 dir="auto">{title}</h1><p>{description}</p></div>{t(children)}</div>;
}

export function StatCard({ icon: Icon, label, value, detail, tone }) {
  useLanguage();
  return <Card className="stat"><span className={'tile ' + tone}><Icon size={19} /></span><span>{t(label)}</span><strong>{t(value)}</strong><small>{t(detail)}</small></Card>;
}

export function EmptyState({ icon: Icon, title, description, children }) {
  useLanguage();
  return <Card className="empty"><span className="tile"><Icon size={23} /></span><h2>{t(title)}</h2><p>{t(description)}</p>{t(children)}</Card>;
}

export function LoadingState({ label = 'Loading' }) {
  useLanguage();
  return <span role="status" className="status"><LoaderCircle className="spin" size={15} />{t(label)}</span>;
}

export function Alert({ children, error = false }) {
  useLanguage();
  return <div role={error ? 'alert' : 'status'} className={'alert ' + (error ? 'error' : '')}><AlertCircle size={18} /> <span>{t(children)}</span></div>;
}

