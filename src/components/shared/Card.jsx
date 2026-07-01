// Glass-morphism card wrapper. `static` disables the hover lift/border.
export default function Card({ children, className = '', static: isStatic = false, ...rest }) {
  return (
    <div className={`card ${isStatic ? 'card--static' : ''} ${className}`} {...rest}>
      {children}
    </div>
  );
}
