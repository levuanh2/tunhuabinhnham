insert into public.site_settings (store_name, facebook_url, messenger_url, hotline, address, about_text)
select 'Tủ Nhựa Bình Nhâm', 'https://facebook.com/', 'https://m.me/', '0900 000 000', 'Cập nhật địa chỉ trong CMS', 'Một không gian trưng bày sản phẩm được chọn lọc.'
where not exists (select 1 from public.site_settings);

insert into public.categories(name, slug, description, sort_order)
values ('Đồ dùng', 'do-dung', 'Những món đồ hữu ích cho cuộc sống hằng ngày.', 1), ('Quà tặng', 'qua-tang', 'Gợi ý quà tặng được chọn kỹ.', 2)
on conflict (slug) do nothing;
