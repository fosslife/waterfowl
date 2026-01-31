import React from 'react';
import clsx from 'clsx';
import styles from './Input.module.css';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    return (
      <div className={styles.container}>
        {label && <label htmlFor={id} className={styles.label}>{label}</label>}
        <div className={styles.inputWrapper}>
          <input
            id={id}
            ref={ref}
            className={clsx(
              styles.input,
              error && styles.hasError,
              className
            )}
            {...props}
          />
        </div>
        {error && <span className={styles.errorMessage}>{error}</span>}
      </div>
    );
  }
);

Input.displayName = 'Input';
