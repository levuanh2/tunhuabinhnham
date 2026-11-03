# Bàn giao CMS — Tủ Nhựa Bình Nhâm

Dành cho chủ cửa hàng. Trang quản trị: **https://tunhuabinhnham.com/admin** (đăng nhập tại `/admin/login`).

Sau mỗi lần lưu, trang web công khai tự cập nhật trong **khoảng 5 phút**. Ảnh đã xoá có thể còn hiện trên trình duyệt của khách tới 1 giờ (CMS sẽ báo nếu chưa dọn được ảnh cũ trên website).

## 0. Trước khi bắt đầu

- [ ] Đăng nhập được bằng email và mật khẩu quản trị. Trang đăng nhập không có nút "Quên mật khẩu": nếu mất mật khẩu, liên hệ người quản trị kỹ thuật.
- [ ] Chỉ tài khoản đã được cấp quyền quản trị mới vào được. Muốn thêm người quản trị mới: nhờ người quản trị kỹ thuật cấp quyền.
- [ ] Dùng mật khẩu mạnh, không chia sẻ tài khoản, đăng xuất trên máy dùng chung.
- [ ] Trang **Tổng quan**: số sản phẩm, sản phẩm đang hiển thị, loại sản phẩm, bài viết, lượt nhấn liên hệ.

## 1. Loại sản phẩm (Danh mục) — `/admin/danh-muc`

- [ ] Thêm loại: nhập **Tên loại** (ví dụ "Tủ quần áo"), **Mô tả ngắn** (không bắt buộc; hiện dưới tiêu đề khi khách lọc theo loại này).
- [ ] Sửa tên/mô tả, bật **Hiện** hoặc ẩn một loại. Sản phẩm thuộc loại đang ẩn sẽ không hiện với khách.
- [ ] Xoá: chỉ xoá được loại không còn sản phẩm. Chuyển sản phẩm sang loại khác trước.

## 2. Sản phẩm — `/admin/san-pham`

- [ ] Tìm theo tên hoặc mã (SKU), lọc theo trạng thái (Đã đăng / Chưa đăng / Đang ẩn).
- [ ] **Thêm sản phẩm**: nhập **Tên sản phẩm**, chọn **Loại sản phẩm**, **Giá bán (VNĐ)** (để trống nếu muốn khách liên hệ hỏi giá), **Tình trạng hàng** (Còn hàng / Hết hàng / Liên hệ), **Mô tả**, **Mã sản phẩm** (không bắt buộc, để trống thì tự tạo).
- [ ] **Ảnh**: JPEG/PNG/WebP, tối đa 20 ảnh mỗi sản phẩm. Ảnh đầu tiên là **Ảnh chính**; dùng "Đặt làm ảnh chính" để đổi; điền **Mô tả ảnh**.
- [ ] **Lưu bản nháp** (khách chưa thấy) hoặc **Đăng sản phẩm**. Bỏ chọn **Hiển thị trên website** để tạm ẩn mà không gỡ đăng.
- [ ] **Đường dẫn sản phẩm** tự tạo từ tên. Đổi tên không đổi đường dẫn. Chỉ đổi đường dẫn khi thật cần ("Chỉnh sửa đường dẫn" → xác nhận): địa chỉ cũ sẽ tự chuyển sang địa chỉ mới. Lần đổi đường dẫn đầu tiên: báo người quản trị kỹ thuật để kiểm tra chuyển hướng 301.
- [ ] Sau khi lưu: bấm **Mở trang sản phẩm**, kiểm tra ảnh, giá, mô tả trên điện thoại.

## 3. Banner trang chủ — `/admin/banner`

- [ ] **Thêm banner**: **Ảnh banner** (JPEG/PNG/WebP, tối đa 8 MiB, khung ngang 12:5), **Tiêu đề**, **Phụ đề**, **Nhãn CTA** và **URL CTA** (nút bấm, ví dụ dẫn tới `/san-pham`), **Thứ tự**.
- [ ] Bật/tắt **Đang hiện**; **Ẩn banner** khi hết chương trình.

## 4. Bài viết — `/admin/bai-viet`

- [ ] **Tạo bài mới**: **Tiêu đề**, **Slug** (đường dẫn), **Tóm tắt**, **Nội dung HTML** (hệ thống tự làm sạch HTML trước khi hiển thị), **SEO title**, **SEO description**.
- [ ] **Ảnh trong bài**: JPEG/PNG/WebP, tối đa 8 MiB mỗi ảnh, 50 ảnh mỗi bài; điền **Mô tả ảnh**.
- [ ] **Trạng thái**: **Bản nháp** hoặc **Xuất bản**. Kiểm tra bài trên `/tin-tuc` sau khoảng 5 phút.

## 5. Thông tin cửa hàng và liên hệ — `/admin/cai-dat`

- [ ] **Tên cửa hàng**, **Logo** (nền trong suốt khuyến nghị), **Favicon** (ảnh vuông).
- [ ] **Hotline**, **Email**, **Địa chỉ**, **Messenger URL**, **Facebook URL**. **Messenger URL phải đúng** vì nút liên hệ trên sản phẩm mở Messenger.
- [ ] **Giới thiệu**, **SEO title mặc định**, **SEO description mặc định**.
- [ ] **Ghi nhận lượt nhấn liên hệ**: bật để đếm lượt khách nhấn liên hệ (xem ở Tổng quan).
- [ ] Sau khi lưu: kiểm tra chân trang, trang `/lien-he`, và thử nút Messenger trên một sản phẩm.

## 6. Kiểm tra định kỳ (mỗi tuần)

- [ ] Mở trang chủ, danh sách sản phẩm, một sản phẩm, trên điện thoại.
- [ ] Sản phẩm hết hàng: đổi **Tình trạng hàng** hoặc tạm ẩn.
- [ ] Lần mở đầu tiên sau nhiều giờ không ai truy cập có thể chậm 30–60 giây (máy chủ miễn phí khởi động lại); các lần sau nhanh bình thường.
- [ ] Gặp lỗi: chụp màn hình, ghi giờ và thao tác, gửi người quản trị kỹ thuật. Không thử xoá hàng loạt để "sửa".
