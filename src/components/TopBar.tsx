import styles from "./app.module.css";

export function TopBar({
  title,
  eyebrow,
  actions,
}: {
  title: string;
  eyebrow?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={styles.topbar}>
      <div>
        {eyebrow && <p className="caption subtle">{eyebrow}</p>}
        <h1>{title}</h1>
      </div>
      {actions && <div className={styles.topActions}>{actions}</div>}
    </div>
  );
}
