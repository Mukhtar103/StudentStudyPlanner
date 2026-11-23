import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from './ui';

export const passwordHint = 'Use at least 8 characters and at most 72 UTF-8 bytes.';
export const validPassword = value => [...value].length >= 8 && new TextEncoder().encode(value).length <= 72;

export default function PasswordInput({ name, label, autoComplete = 'new-password', ...props }) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return <Input required name={name} label={label} type={visible ? 'text' : 'password'} autoComplete={autoComplete} {...props}
    action={<button className="icon-button visibility" type="button" aria-label={(visible ? 'Hide ' : 'Show ') + label.toLowerCase()}
      onClick={() => setVisible(value => !value)}><Icon size={18} /></button>} />;
}
