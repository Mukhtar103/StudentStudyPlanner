import { Link } from 'react-router-dom';
import { AlertCircle, LoaderCircle } from 'lucide-react';

export function Button({ to, variant = 'primary', className = '', ...props }) {
  const classes = 'button ' + variant + ' ' + className;
  return to ? <Link to={to} className={classes} {...props} /> : <button type="button" className={classes} {...props} />;
}

export function Input({ name, label, error, action, 'aria-describedby': describedBy, ...props }) {
  return <div className="field">
    <label htmlFor={name}>{label}</label>
    <div className="input-wrap">
      <input id={name} name={name} aria-invalid={Boolean(error)} aria-describedby={[describedBy, error && name + '-error'].filter(Boolean).join(' ') || undefined} {...props} />
      {action}
    </div>
    {error && <small id={name + '-error'}>{error}</small>}
  </div>;
}

export function Card({ children, className = '' }) {
  return <section className={'card ' + className}>{children}</section>;
}

export function PageHeader({ title, description, children }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{children}</div>;
}

export function StatCard({ icon: Icon, label, value, detail, tone }) {
  return <Card className="stat"><span className={'tile ' + tone}><Icon size={19} /></span><span>{label}</span><strong>{value}</strong><small>{detail}</small></Card>;
}

export function EmptyState({ icon: Icon, title, description, children }) {
  return <Card className="empty"><span className="tile"><Icon size={23} /></span><h2>{title}</h2><p>{description}</p>{children}</Card>;
}

export function LoadingState({ label = 'Loading' }) {
  return <span role="status" className="status"><LoaderCircle className="spin" size={15} />{label}</span>;
}

export function Alert({ children, error = false }) {
  return <div role={error ? 'alert' : 'status'} className={'alert ' + (error ? 'error' : '')}><AlertCircle size={18} /> <span>{children}</span></div>;
}

