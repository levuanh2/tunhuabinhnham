import { AdminPageHeader } from "@/components/admin-shell";
import { ProductForm } from "@/features/admin/product-form";
export default function NewProductPage() { return <><AdminPageHeader title="Thêm sản phẩm" description="Nhập tên, chọn loại tủ, thêm ảnh rồi lưu. Chọn Chưa đăng nếu chưa muốn khách thấy." /><ProductForm /></>; }
