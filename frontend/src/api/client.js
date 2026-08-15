// Compatibility wrapper for older imports. The canonical API client lives in ../api.js.
export { api as default, api } from '../api.js';

export function apiErrorMessage(err) {
  return err?.message || 'Đã có lỗi xảy ra, vui lòng thử lại.';
}
