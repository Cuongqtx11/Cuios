import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta # Import timedelta
import pytz
import gspread
import os
import logging # Import logging module

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

revenue_mapping = {
    -49500: 69000, 
    -215000: 369000,
    -60000: 79000,
    -86400: 119000,
    -75000: 111000,
    -110000: 149000, 
    -130000: 169000 
}

cost_mapping = {
    -49500: 49500,
    -215000: 215000,
    -60000: 60000,
    -86400: 86400,
    -75000: 75000,
    -110000: 110000,
    -130000: 130000 
}

product_name_mapping_by_revenue = {
    369000: "Unband Vip",
    69000: "Cert 72h",
    79000: "Cert 72h++",
    119000: "Cert 24h",
    111000: "Premium 72h",
    149000: "Combo 72H",
    169000: "Combo 24h"
}

# Hàm để đọc chuỗi cookie từ Google Sheet
def read_cookie_from_google_sheet(spreadsheet_name, cookie_sheet_name, credentials_path='credentials.json'):
    try:
        gc = gspread.service_account(filename=credentials_path)
        sh = gc.open(spreadsheet_name)
        cookie_worksheet = sh.worksheet(cookie_sheet_name)
        cookie_string = cookie_worksheet.acell('B1').value
        if not cookie_string:
            logging.warning("Cảnh báo: Chuỗi cookie trong Google Sheet trống.")
        return cookie_string
    except Exception as e:
        logging.error(f"Lỗi khi đọc cookie từ Google Sheet: {e}", exc_info=True)
        return None

# Hàm lấy dữ liệu đơn hàng từ HTML (chỉ tháng hiện tại)
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
    
    try:
        response = requests.get(url, headers=headers, cookies=cookies, timeout=15) # Add timeout
        response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)
    except requests.exceptions.RequestException as e:
        logging.error(f"Lỗi khi truy cập URL {url}: {e}", exc_info=True)
        raise Exception(f"Không thể truy cập URL: {url}. Lỗi kết nối hoặc phản hồi không thành công.")

    html = response.text
    soup = BeautifulSoup(html, "html.parser")
    orders_data = []

    rows = soup.find_all("tr")
    if not rows:
        logging.warning("Không tìm thấy hàng (<tr>) nào trong HTML. Có thể cấu trúc trang đã thay đổi.")
        return []

    vn_tz = pytz.timezone("Asia/Ho_Chi_Minh")
    now_vn = datetime.now(vn_tz) # Lấy thời gian hiện tại theo múi giờ Việt Nam

    for i, row in enumerate(rows):
        cols = row.find_all("td")
        if len(cols) >= 3:
            date_str = cols[2].text.strip()
            try:
                date_obj = datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")
                # Lọc chỉ lấy dữ liệu của tháng và năm hiện tại
                if not (date_obj.year == now_vn.year and date_obj.month == now_vn.month):
                    continue # Bỏ qua các đơn hàng không thuộc tháng hiện tại
            except ValueError:
                logging.warning(f"Bỏ qua hàng {i+1} do định dạng ngày không hợp lệ: '{date_str}'")
                continue

            original_amount_str = cols[0].text.strip().replace(' đ', '').replace(',', '').replace('.', '')
            try:
                original_amount = int(original_amount_str)
            except ValueError:
                logging.warning(f"Bỏ qua hàng {i+1} do định dạng số tiền gốc không hợp lệ: '{original_amount_str}'")
                original_amount = 0 # Gán 0 nếu không thể parse

            actual_revenue = revenue_mapping.get(original_amount, 0)
            actual_cost = cost_mapping.get(original_amount, 0)
            
            if actual_revenue == 0 and original_amount != 0:
                logging.warning(f"Không tìm thấy ánh xạ doanh thu cho số tiền gốc: {original_amount}")
            if actual_cost == 0 and original_amount != 0:
                logging.warning(f"Không tìm thấy ánh xạ giá vốn cho số tiền gốc: {original_amount}")

            order_content = cols[1].text.strip()
            order_code = order_content.split('#')[-1] if '#' in order_content else ''

            orders_data.append({
                'date': date_str,
                'content': order_content,
                'original_amount': original_amount,
                'actual_revenue': actual_revenue,
                'actual_cost': actual_cost,
                'order_code': order_code
            })
    return orders_data

# Hàm cập nhật dữ liệu vào Google Sheet 'Lich Su Giao Dich' (chỉ tháng hiện tại)
def update_google_sheet(orders_data, spreadsheet_name, lịch_sử_giao_dịch_sheet_name, credentials_path='credentials.json'):
    try:
        gc = gspread.service_account(filename=credentials_path)
        sh = gc.open(spreadsheet_name)
        
        # Lấy hoặc tạo sheet nếu chưa có
        try:
            worksheet = sh.worksheet(lịch_sử_giao_dịch_sheet_name)
            logging.info(f"Đã tìm thấy sheet '{lịch_sử_giao_dịch_sheet_name}'.")
        except gspread.exceptions.WorksheetNotFound:
            worksheet = sh.add_worksheet(title=lịch_sử_giao_dịch_sheet_name, rows="1000", cols="10")
            logging.info(f"Đã tạo mới sheet '{lịch_sử_giao_dịch_sheet_name}'.")

        # Xóa dữ liệu cũ trên sheet 'Lich Su Giao Dich'
        worksheet.clear()
        logging.info(f"Đã xóa dữ liệu cũ trên sheet '{lịch_sử_giao_dịch_sheet_name}'.")
        
        # Chuẩn bị dữ liệu để ghi, bao gồm cả tiêu đề và các dòng dữ liệu
        all_data_to_write = [['STT', 'Ngày', 'Nội dung', 'Doanh thu (Khách trả)', 'Giá vốn (Tôi trả)', 'Mã đơn hàng', 'Lãi/Lỗ', 'Ghi chú']]
        
        orders_data_sorted = sorted(orders_data, key=lambda x: datetime.strptime(x['date'], "%Y-%m-%d %H:%M:%S"), reverse=False)

        for i, order in enumerate(orders_data_sorted):
            row_num = i + 2 # Dữ liệu bắt đầu từ hàng thứ 2 sau tiêu đề
            all_data_to_write.append([
                i + 1,
                order['date'],
                order['content'],
                order['actual_revenue'],
                order['actual_cost'],
                order['order_code'],
                f"=D{row_num}-E{row_num}", # Công thức Lãi/Lỗ
                ""
            ])

        # Sử dụng batch_update để giảm số lượng request API và tăng hiệu suất
        updates = []

        if all_data_to_write:
            end_row_for_data = len(all_data_to_write)
            updates.append({
                'range': f'A1:H{end_row_for_data}',
                'values': all_data_to_write
            })
            logging.info(f"Đã chuẩn bị {len(all_data_to_write) - 1} dòng lịch sử giao dịch và tiêu đề.")
            last_data_row_for_formulas = end_row_for_data
        else:
            updates.append({
                'range': 'A1:H1',
                'values': [['STT', 'Ngày', 'Nội dung', 'Doanh thu (Khách trả)', 'Giá vốn (Tôi trả)', 'Mã đơn hàng', 'Lãi/Lỗ', 'Ghi chú']]
            })
            logging.info("Không có dữ liệu đơn hàng nào để ghi vào sheet 'Lich Su Giao Dich'. Chỉ cập nhật tiêu đề.")
            last_data_row_for_formulas = 1

        # Thêm dòng tổng lãi/lỗ
        total_profit_loss_row = last_data_row_for_formulas + 1
        sum_range = f"G2:G{last_data_row_for_formulas}" if last_data_row_for_formulas > 1 else "G2"
        updates.append({
            'range': f'F{total_profit_loss_row}:G{total_profit_loss_row}',
            'values': [
                ["Tổng Lãi/Lỗ:", f"=SUM({sum_range})"]
            ]
        })
        logging.info(f"Đã chuẩn bị công thức tổng lãi/lỗ tại ô G{total_profit_loss_row}.")

        # --- Thêm phần tổng hợp số lượng đơn hàng theo loại sản phẩm ---
        summary_current_row = total_profit_loss_row + 2

        total_orders = len(orders_data_sorted)
        updates.append({
            'range': f'F{summary_current_row}:G{summary_current_row}',
            'values': [
                ["Tổng số đơn hàng:", total_orders]
            ]
        })
        logging.info(f"Đã chuẩn bị tổng số đơn hàng ({total_orders}).")
        summary_current_row += 1

        item_counts = {}
        for order in orders_data_sorted:
            product_name = product_name_mapping_by_revenue.get(order['actual_revenue'], order['content'])
            item_counts[product_name] = item_counts.get(product_name, 0) + 1
            
        sorted_items = sorted(item_counts.items(), key=lambda item: item[1], reverse=True)

        summary_current_row += 1
        updates.append({
            'range': f'F{summary_current_row}',
            'values': [["Thống kê theo mặt hàng:"]]
        })
        summary_current_row += 1

        data_to_update_items = []
        for item_name, count in sorted_items:
            data_to_update_items.append([item_name, count])
            
        if data_to_update_items:
            updates.append({
                'range': f'F{summary_current_row}:G{summary_current_row + len(data_to_update_items) - 1}',
                'values': data_to_update_items
            })
            logging.info("Đã chuẩn bị thống kê theo mặt hàng.")

        if updates:
            worksheet.batch_update(updates, value_input_option='USER_ENTERED')
            logging.info(f"Đã thực hiện batch update cho sheet '{lịch_sử_giao_dịch_sheet_name}'.")
        else:
            logging.info(f"Không có cập nhật nào được chuẩn bị cho sheet '{lịch_sử_giao_dịch_sheet_name}'.")

        return True
    except Exception as e:
        logging.error(f"Lỗi khi cập nhật Google Sheet '{lịch_sử_giao_dịch_sheet_name}': {e}", exc_info=True)
        return False

# HÀM MỚI: Lưu trữ dữ liệu tháng vào sheet riêng
def archive_monthly_data(orders_data, spreadsheet_name, credentials_path='credentials.json'):
    vn_tz = pytz.timezone("Asia/Ho_Chi_Minh")
    now_vn = datetime.now(vn_tz)
    
    # Định dạng tên sheet theo tháng và năm hiện tại (ví dụ: LichSu_2025_07)
    # Tên này sẽ duy nhất cho mỗi tháng
    archive_sheet_name = now_vn.strftime("LichSu_%Y_%m")
    
    try:
        gc = gspread.service_account(filename=credentials_path)
        sh = gc.open(spreadsheet_name)

        # Kiểm tra xem sheet lưu trữ của tháng đã tồn tại chưa
        try:
            worksheet = sh.worksheet(archive_sheet_name)
            logging.info(f"Đã tìm thấy sheet lưu trữ tháng: '{archive_sheet_name}'.")
        except gspread.exceptions.WorksheetNotFound:
            # Nếu chưa tồn tại, tạo sheet mới. Gspread mặc định rows/cols là 100/26, có thể chỉnh nếu cần.
            worksheet = sh.add_worksheet(title=archive_sheet_name, rows="1000", cols="10") 
            logging.info(f"Đã tạo mới sheet lưu trữ tháng: '{archive_sheet_name}'.")

        # Xóa dữ liệu cũ trên sheet lưu trữ này để cập nhật lại toàn bộ dữ liệu của tháng hiện tại
        # Điều này đảm bảo dữ liệu trong sheet LichSu_YYYY_MM luôn là bản mới nhất của tháng đó
        worksheet.clear()
        logging.info(f"Đã xóa dữ liệu cũ trên sheet lưu trữ '{archive_sheet_name}' để cập nhật.")

        # Chuẩn bị dữ liệu để ghi, bao gồm cả tiêu đề và các dòng dữ liệu
        # Cấu trúc cột vẫn giữ nguyên như sheet 'Lich Su Giao Dich'
        all_data_to_write = [['STT', 'Ngày', 'Nội dung', 'Doanh thu (Khách trả)', 'Giá vốn (Tôi trả)', 'Mã đơn hàng', 'Lãi/Lỗ', 'Ghi chú']]
        
        # orders_data ở đây chỉ chứa dữ liệu của tháng hiện tại
        orders_data_sorted = sorted(orders_data, key=lambda x: datetime.strptime(x['date'], "%Y-%m-%d %H:%M:%S"), reverse=False)

        for i, order in enumerate(orders_data_sorted):
            row_num = i + 2 # Dữ liệu bắt đầu từ hàng thứ 2 sau tiêu đề
            all_data_to_write.append([
                i + 1,
                order['date'],
                order['content'],
                order['actual_revenue'],
                order['actual_cost'],
                order['order_code'],
                f"=D{row_num}-E{row_num}", # Công thức Lãi/Lỗ
                ""
            ])

        # Sử dụng batch_update để hiệu quả hơn
        updates_for_archive_sheet = []

        if all_data_to_write:
            end_row_for_data = len(all_data_to_write)
            updates_for_archive_sheet.append({
                'range': f'A1:H{end_row_for_data}',
                'values': all_data_to_write
            })
            logging.info(f"Đã chuẩn bị {len(all_data_to_write) - 1} dòng dữ liệu cho sheet lưu trữ '{archive_sheet_name}'.")
            last_data_row_for_formulas = end_row_for_data
        else:
            updates_for_archive_sheet.append({
                'range': 'A1:H1',
                'values': [['STT', 'Ngày', 'Nội dung', 'Doanh thu (Khách trả)', 'Giá vốn (Tôi trả)', 'Mã đơn hàng', 'Lãi/Lỗ', 'Ghi chú']]
            })
            logging.info("Không có dữ liệu đơn hàng nào để ghi vào sheet lưu trữ tháng. Chỉ cập nhật tiêu đề.")
            last_data_row_for_formulas = 1

        # Thêm dòng tổng lãi/lỗ cho sheet lưu trữ
        total_profit_loss_row = last_data_row_for_formulas + 1
        sum_range = f"G2:G{last_data_row_for_formulas}" if last_data_row_for_formulas > 1 else "G2"
        updates_for_archive_sheet.append({
            'range': f'F{total_profit_loss_row}:G{total_profit_loss_row}',
            'values': [
                ["Tổng Lãi/Lỗ:", f"=SUM({sum_range})"]
            ]
        })
        logging.info(f"Đã chuẩn bị công thức tổng lãi/lỗ tại ô G{total_profit_loss_row} cho sheet lưu trữ.")

        # Thêm phần tổng hợp số lượng đơn hàng theo loại sản phẩm cho sheet lưu trữ
        summary_current_row = total_profit_loss_row + 2
        total_orders = len(orders_data_sorted)
        updates_for_archive_sheet.append({
            'range': f'F{summary_current_row}:G{summary_current_row}',
            'values': [
                ["Tổng số đơn hàng:", total_orders]
            ]
        })
        logging.info(f"Đã chuẩn bị tổng số đơn hàng ({total_orders}) cho sheet lưu trữ.")
        summary_current_row += 1

        item_counts = {}
        for order in orders_data_sorted:
            product_name = product_name_mapping_by_revenue.get(order['actual_revenue'], order['content'])
            item_counts[product_name] = item_counts.get(product_name, 0) + 1
            
        sorted_items = sorted(item_counts.items(), key=lambda item: item[1], reverse=True)

        summary_current_row += 1
        updates_for_archive_sheet.append({
            'range': f'F{summary_current_row}',
            'values': [["Thống kê theo mặt hàng:"]]
        })
        summary_current_row += 1

        data_to_update_items = []
        for item_name, count in sorted_items:
            data_to_update_items.append([item_name, count])
            
        if data_to_update_items:
            updates_for_archive_sheet.append({
                'range': f'F{summary_current_row}:G{summary_current_row + len(data_to_update_items) - 1}',
                'values': data_to_update_items
            })
            logging.info("Đã chuẩn bị thống kê theo mặt hàng cho sheet lưu trữ.")

        if updates_for_archive_sheet:
            worksheet.batch_update(updates_for_archive_sheet, value_input_option='USER_ENTERED')
            logging.info(f"Đã thực hiện batch update cho sheet lưu trữ '{archive_sheet_name}'.")
        else:
            logging.info(f"Không có cập nhật nào được chuẩn bị cho sheet lưu trữ '{archive_sheet_name}'.")

        return True
    except Exception as e:
        logging.error(f"Lỗi khi cập nhật Google Sheet lưu trữ tháng '{archive_sheet_name}': {e}", exc_info=True)
        return False


# Hàm chính để GitHub Action gọi
if __name__ == '__main__':
    spreadsheet_name = os.getenv('GOOGLE_SHEET_NAME', 'Bao Cao Doanh Thu Thang')
    cookie_sheet_name = os.getenv('COOKIE_SHEET_NAME', 'Cookie_Config')
    lịch_sử_giao_dịch_sheet_name = os.getenv('TRANSACTION_HISTORY_SHEET_NAME', 'Lich Su Giao Dich') # Tên sheet cũ bạn muốn giữ
    url_to_scrape = os.getenv('URL_TO_SCRAPE', "https://p12apple.com/api/balance_history")
    credentials_file_path = os.getenv('GSPREAD_CREDENTIALS_PATH', 'credentials.json')

    try:
        logging.info("Bắt đầu quy trình cập nhật doanh thu...")

        # 1. Đọc cookie từ Google Sheet
        cookies_string = read_cookie_from_google_sheet(
            spreadsheet_name, cookie_sheet_name, credentials_file_path
        )
        if not cookies_string:
            logging.critical("Không thể lấy cookie từ Google Sheet. Đang thoát.")
            exit(1)

        # 2. Lấy dữ liệu đơn hàng từ trang web (chỉ tháng hiện tại)
        logging.info("Đang lấy dữ liệu đơn hàng từ trang web (chỉ tháng hiện tại)...")
        orders_data = get_orders_data_from_html(url_to_scrape, cookies_string)
        logging.info(f"Đã lấy được {len(orders_data)} đơn hàng trong tháng hiện tại.")

        # 3. Cập nhật dữ liệu vào Google Sheet 'Lich Su Giao Dich' (sheet chính, chỉ chứa tháng hiện tại)
        logging.info(f"Đang cập nhật dữ liệu vào Google Sheet '{lịch_sử_giao_dịch_sheet_name}'...")
        if update_google_sheet(
            orders_data, spreadsheet_name, lịch_sử_giao_dịch_sheet_name,
            credentials_file_path
        ):
            logging.info(f"Cập nhật thành công sheet '{lịch_sử_giao_dịch_sheet_name}'!")
        else:
            logging.error(f"Có lỗi khi cập nhật sheet '{lịch_sử_giao_dịch_sheet_name}'. Vui lòng kiểm tra logs.")
            exit(1) 

        # 4. Lưu trữ dữ liệu tháng hiện tại vào một sheet riêng (LichSu_YYYY_MM)
        logging.info(f"Đang lưu trữ dữ liệu tháng hiện tại vào sheet riêng...")
        if archive_monthly_data(
            orders_data, spreadsheet_name, credentials_file_path
        ):
            logging.info(f"Lưu trữ dữ liệu tháng thành công!")
        else:
            logging.error(f"Có lỗi khi lưu trữ dữ liệu tháng. Vui lòng kiểm tra logs.")
            exit(1)

    except Exception as e:
        logging.critical(f"Đã xảy ra lỗi nghiêm trọng trong quá trình thực thi: {e}", exc_info=True)
        exit(1)
