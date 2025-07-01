import requests
from bs4 import BeautifulSoup
from datetime import datetime
import pytz
import gspread
import os

# --- Cấu hình ánh xạ doanh thu và giá vốn của bạn ---
# Key là "Số tiền" gốc từ lịch sử giao dịch (luôn là số âm)
# Value là số tiền "Doanh thu (Khách trả)"
revenue_mapping = {
    -49500: 69000, #72
    -215000: 369000, #ubln
    -60000: 79000, #72+
    -86400: 119000, #24
    -75000: 111000, #vbh555
    -110000: 149000, #ul72
    -130000: 169000 #ul24
}

# Giá vốn là giá trị tuyệt đối của "Số tiền" gốc từ lịch sử giao dịch
cost_mapping = {
    -49500: 49500,
    -215000: 215000,
    -60000: 60000,
    -86400: 86400,
    -75000: 75000,
    -110000: 110000,
    -130000: 130000 # Giá trị tuyệt đối của số tiền gốc
}

# Hàm để đọc chuỗi cookie từ Google Sheet
def read_cookie_from_google_sheet(spreadsheet_name, cookie_sheet_name, credentials_path='credentials.json'):
    try:
        gc = gspread.service_account(filename=credentials_path)
        sh = gc.open(spreadsheet_name)
        cookie_worksheet = sh.worksheet(cookie_sheet_name)
        cookie_string = cookie_worksheet.acell('B1').value
        if not cookie_string:
            print("Cảnh báo: Chuỗi cookie trong Google Sheet trống.")
        return cookie_string
    except Exception as e:
        print(f"Lỗi khi đọc cookie từ Google Sheet: {e}")
        return None

# Hàm lấy dữ liệu đơn hàng từ HTML
# LƯU Ý: Với URL 'api/balance_history', bạn có thể cần điều chỉnh cách phân tích cú pháp
# nếu nó trả về JSON thay vì HTML. Hiện tại, code vẫn dùng BeautifulSoup để phân tích HTML.
# Nếu API trả về JSON, bạn sẽ cần dùng thư viện 'json' thay vì 'BeautifulSoup'.
def get_orders_data_from_html(url, cookies_str):
    cookies = {}
    if cookies_str:
        for part in cookies_str.split(';'):
            if "=" in part:
                key, value = part.strip().split("=", 1)
                cookies[key] = value
    else:
        raise ValueError("Cookie string rỗng hoặc không hợp lệ. Không thể tiến hành lấy dữ liệu.")

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    }
    response = requests.get(url, headers=headers, cookies=cookies)

    if response.status_code == 200:
        html = response.text
        soup = BeautifulSoup(html, "html.parser")
        orders_data = []

        rows = soup.find_all("tr") # Giả định API vẫn trả về HTML có cấu trúc bảng
        for i, row in enumerate(rows):
            cols = row.find_all("td")
            if len(cols) >= 3:
                date_str = cols[2].text.strip()
                try:
                    date_obj = datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")
                    vn_tz = pytz.timezone("Asia/Ho_Chi_Minh")
                    now = datetime.now(vn_tz)
                    # Chỉ lấy đơn hàng của tháng hiện tại
                    if not (date_obj.year == now.year and date_obj.month == now.month):
                        continue
                except ValueError:
                    continue # Bỏ qua nếu định dạng ngày không đúng

                original_amount_str = cols[0].text.strip().replace(' đ', '').replace(',', '').replace('.', '')
                try:
                    original_amount = int(original_amount_str) # Đây là số tiền âm từ dữ liệu thô
                except ValueError:
                    original_amount = 0

                # Lấy doanh thu thực tế và giá vốn từ mapping
                actual_revenue = revenue_mapping.get(original_amount, 0)
                actual_cost = cost_mapping.get(original_amount, 0) # Lấy giá trị tuyệt đối cho giá vốn

                order_content = cols[1].text.strip()
                order_code = order_content.split('#')[-1] if '#' in order_content else ''

                orders_data.append({
                    'date': date_str,
                    'content': order_content,
                    'original_amount': original_amount, # Giữ lại để debug nếu cần
                    'actual_revenue': actual_revenue,
                    'actual_cost': actual_cost,
                    'order_code': order_code
                })
        return orders_data
    else:
        raise Exception(f"Không thể truy cập URL: {url}. Status code: {response.status_code}. Vui lòng kiểm tra lại URL hoặc cookie.")

# Hàm cập nhật dữ liệu vào Google Sheet
def update_google_sheet(orders_data, spreadsheet_name, lịch_sử_giao_dịch_sheet_name, tổng_hợp_doanh_thu_sheet_name, credentials_path='credentials.json'):
    try:
        gc = gspread.service_account(filename=credentials_path)
        sh = gc.open(spreadsheet_name)
        worksheet = sh.worksheet(lịch_sử_giao_dịch_sheet_name)
        summary_worksheet = sh.worksheet(tổng_hợp_doanh_thu_sheet_name)

        # Xóa dữ liệu cũ trên sheet 'Lich Su Giao Dich' (giữ lại hàng tiêu đề)
        worksheet.clear() # Xóa tất cả các ô
        worksheet.update(range_name='A1:H1', values=[['STT', 'Ngày', 'Nội dung', 'Doanh thu (Khách trả)', 'Giá vốn (Tôi trả)', 'Mã đơn hàng', 'Lãi/Lỗ', 'Ghi chú']])
        print("Đã xóa dữ liệu cũ và cập nhật tiêu đề trên sheet 'Lich Su Giao Dich'.")

        data_to_write = []
        total_monthly_revenue = 0
        
        # Sắp xếp lại dữ liệu theo ngày mới nhất lên đầu (tùy chọn)
        orders_data_sorted = sorted(orders_data, key=lambda x: datetime.strptime(x['date'], "%Y-%m-%d %H:%M:%S"), reverse=False)

        for i, order in enumerate(orders_data_sorted):
            row_num = i + 2 # Dữ liệu bắt đầu từ hàng thứ 2 sau tiêu đề
            data_to_write.append([
                i + 1, # STT
                order['date'],
                order['content'],
                order['actual_revenue'], # Đây là "Doanh thu (Khách trả)"
                order['actual_cost'],    # Đây là "Giá vốn (Tôi trả)"
                order['order_code'],
                f"=D{row_num}-E{row_num}", # Ghi công thức Lãi/Lỗ vào đây
                ""  # Cột Ghi chú
            ])
            total_monthly_revenue += order['actual_revenue']

        if data_to_write:
            # gspread sẽ tự động nhận diện chuỗi bắt đầu bằng "=" là công thức
            worksheet.append_rows(data_to_write)
            print(f"Đã ghi {len(data_to_write)} lịch sử giao dịch vào Google Sheet 'Lich Su Giao Dich'.")
        else:
            print("Không có dữ liệu đơn hàng nào để ghi vào sheet 'Lich Su Giao Dich'.")

        # Cập nhật tổng doanh thu vào sheet 'Tong Hop Doanh Thu'
        summary_worksheet.clear() # Xóa tất cả các ô trên sheet tổng hợp
        summary_worksheet.update(range_name='A1', values=[['Tổng Doanh Thu Tháng Này:']])
        summary_worksheet.update(range_name='B1', values=[[total_monthly_revenue]])
        
        # Thêm lại dòng tiêu đề "Tổng Lãi/Lỗ Tháng Này:" và công thức của nó
        summary_worksheet.update(range_name='A2', values=[['Tổng Lãi/Lỗ Tháng Này:']])
        # Sử dụng value_input_option='USER_ENTERED' để đảm bảo chuỗi được phân tích là công thức
        summary_worksheet.update(range_name='B2', values=[["=SUMPRODUCT('Lich Su Giao Dich'!D:D - 'Lich Su Giao Dich'!E:E)"]], value_input_option='USER_ENTERED')

        print(f"Tổng doanh thu tháng này ({total_monthly_revenue:,} VNĐ) và tổng lãi/lỗ đã được cập nhật vào sheet 'Tong Hop Doanh Thu'.")
        return True
    except Exception as e:
        print(f"Lỗi khi cập nhật Google Sheet: {e}")
        return False

# Hàm chính để GitHub Action gọi
if __name__ == '__main__':
    spreadsheet_name = 'Bao Cao Doanh Thu Thang'
    cookie_sheet_name = 'Cookie_Config'
    lịch_sử_giao_dịch_sheet_name = 'Lich Su Giao Dich'
    tổng_hợp_doanh_thu_sheet_name = 'Tong Hop Doanh Thu'
    url_to_scrape = "https://p12apple.com/api/balance_history"
    credentials_file_path = 'credentials.json' 

    try:
        print("Bắt đầu quy trình cập nhật doanh thu...")

        # 1. Đọc cookie từ Google Sheet
        cookies_string = read_cookie_from_google_sheet(
            spreadsheet_name, cookie_sheet_name, credentials_file_path
        )
        if not cookies_string:
            print("Không thể lấy cookie từ Google Sheet. Vui lòng kiểm tra sheet 'Cookie_Config' và file 'credentials.json'.")
            exit(1) # Thoát với mã lỗi

        # 2. Lấy dữ liệu đơn hàng từ trang web
        print("Đang lấy dữ liệu đơn hàng từ trang web...")
        orders_data = get_orders_data_from_html(url_to_scrape, cookies_string)
        print(f"Đã lấy được {len(orders_data)} đơn hàng trong tháng hiện tại.")

        # 3. Cập nhật dữ liệu vào Google Sheet
        print("Đang cập nhật dữ liệu vào Google Sheet...")
        if update_google_sheet(
            orders_data, spreadsheet_name, lịch_sử_giao_dịch_sheet_name,
            tổng_hợp_doanh_thu_sheet_name, credentials_file_path
        ):
            print("Cập nhật doanh thu thành công vào Google Sheet!")
        else:
            print("Có lỗi khi cập nhật Google Sheet. Vui lòng kiểm tra logs.")
            exit(1) # Thoát với mã lỗi
    except Exception as e:
        print(f"Đã xảy ra lỗi tổng quát trong quá trình thực thi: {e}")
        exit(1) # Thoát với mã lỗi
