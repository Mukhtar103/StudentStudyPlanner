import { t, useLanguage } from '../services/language';
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from './ui';

export const passwordHint = 'Use exactly 8 characters.';
export const validPassword = value => [...value].length === 8;

export default function PasswordInput({ name, label, autoComplete = 'new-password', ...props }) {
  useLanguage();
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return <Input required name={name} label={t(label)} type={visible ? 'text' : 'password'} autoComplete={autoComplete} {...props}
    onChange={event => {
      if (autoComplete === 'new-password') event.target.value = [...event.target.value].slice(0, 8).join('');
      props.onChange?.(event);
    }}
    action={<button className="icon-button visibility" type="button" aria-label={(visible ? t('Hide ') : t('Show ')) + t(label.toLowerCase())}
      onClick={() => setVisible(value => !value)}><Icon size={18} /></button>} />;
}
