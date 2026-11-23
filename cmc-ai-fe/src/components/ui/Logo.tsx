import logoBlue from '../../assets/brand/cmc-university-logo-blue.png';
import logoWhite from '../../assets/brand/cmc-university-logo-white.png';

/**
 * Logo chính thức Trường Đại học CMC (tải từ cmcu.edu.vn – không vẽ lại, không chỉnh sửa)
 * + tên sản phẩm "CMC AI" dạng chữ phẳng.
 * tone="auto": tự đổi bản xanh/trắng theo nền (CSS: [data-theme='dark']).
 */
export function Brand({ compact = false, tone = 'auto' }: { compact?: boolean; tone?: 'auto' | 'light' | 'dark' }) {
  return (
    <div className={`brand brand-${tone}`}>
      <span className="brand-logo">
        <img className="logo-on-light" src={logoBlue} alt="Trường Đại học CMC" width={715} height={127} />
        <img className="logo-on-dark" src={logoWhite} alt="Trường Đại học CMC" width={715} height={127} />
      </span>
      {!compact && (
        <span className="brand-text">
          <span className="brand-name">CMC AI</span>
          <span className="brand-sub">Giám sát phòng thi</span>
        </span>
      )}
    </div>
  );
}
