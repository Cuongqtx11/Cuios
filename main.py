import requests
from bs4 import BeautifulSoup
from datetime import datetime
import pytz
import gspread
import os
import logging # Import the logging module
from collections import defaultdict # To help with grouping data for summary

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Mappings (có thể xem xét đọc từ file cấu hình hoặc GSheet)
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

def read_cookie_from_google_sheet(spreadsheet_name, cookie_sheet_name, credentials_path):
    """
    Đọc chuỗi cookie từ Google Sheet.
    """
    try:
        gc = gspread.service_account(filename=credentials_path)
        sh = gc.open(spreadsheet_name)
        cookie_worksheet = sh.worksheet(cookie_sheet_name)
        cookie_string = cookie_worksheet.acell('B1').value
        if not cookie_string:
            logging.warning("Cookie string trong Google Sheet trống.")
        return cookie_string
    except Exception as e:
        logging.error(f"Lỗi khi đọc cookie từ Google Sheet: {e}", exc_info=True)
        return None

def get_orders_data_from_html(url, cookies_str):
    """
    Lấy toàn bộ dữ liệu đơn hàng từ HTML của trang web.
    """
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
        response = requests.get(url, headers=headers, cookies=cookies, timeout=15) # Tăng timeout một chút
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

    for i, row in enumerate(rows):
        cols = row.find_all("td")
        if len(cols) >= 3:
            date_str = cols[2].text.strip()
            try:
                # Không còn lọc theo tháng hiện tại nữa, lấy toàn bộ
                date_obj = datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")
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

def update_transaction_history_sheet(orders_data, spreadsheet_name, history_sheet_name, credentials_path):
    """
    Cập nhật toàn bộ dữ liệu đơn hàng vào Google Sheet 'Lich Su Giao Dich'.
    """
    try:
        gc = gspread.service_account(filename=credentials_path)
        sh = gc.open(spreadsheet_name)
        worksheet = sh.worksheet(history_sheet_name)

        # Xóa dữ liệu cũ trên sheet 'Lich Su Giao Dich' để cập nhật toàn bộ
        worksheet.clear()
        logging.info(f"Đã xóa dữ liệu cũ trên sheet '{history_sheet_name}'.")
        
        # Chuẩn bị dữ liệu để ghi, bao gồm cả tiêu đề và các dòng dữ liệu
        all_data_to_write = [['STT', 'Ngày', 'Nội dung', 'Doanh thu (Khách trả)', 'Giá vốn (Tôi trả)', 'Mã đơn hàng', 'Lãi/Lỗ', 'Ghi chú']]
        
        # Sắp xếp theo ngày tăng dần để dễ đọc và tính toán công thức
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
        
        updates = []

        if all_data_to_write:
            end_row_for_data = len(all_data_to_write)
            updates.append({
                'range': f'A1:H{end_row_for_data}',
                'values': all_data_to_write
            })
            logging.info(f"Đã chuẩn bị {len(all_data_to_write) - 1} dòng dữ liệu giao dịch và tiêu đề.")
            last_data_row_for_formulas = end_row_for_data # Hàng cuối cùng có dữ liệu giao dịch
        else:
            updates.append({
                'range': 'A1:H1',
                'values': [['STT', 'Ngày', 'Nội dung', 'Doanh thu (Khách trả)', 'Giá vốn (Tôi trả)', 'Mã đơn hàng', 'Lãi/Lỗ', 'Ghi chú']]
            })
            logging.info("Không có dữ liệu đơn hàng nào để ghi vào sheet 'Lich Su Giao Dich'. Chỉ cập nhật tiêu đề.")
            last_data_row_for_formulas = 1 # Chỉ có hàng tiêu đề tồn tại, công thức sẽ tham chiếu D2:G1 (sẽ ra lỗi #REF!)

        # Thêm dòng tổng lãi/lỗ
        total_profit_loss_row = last_data_row_for_formulas + 1
        # Chỉ đặt công thức nếu có dữ liệu thực sự (tức là có ít nhất 1 dòng dữ liệu ngoài tiêu đề)
        sum_range = f"G2:G{last_data_row_for_formulas}" if last_data_row_for_formulas > 1 else "G2"
        updates.append({
            'range': f'F{total_profit_loss_row}:G{total_profit_loss_row}',
            'values': [
                ["Tổng Lãi/Lỗ:", f"=SUM({sum_range})"]
            ]
        })
        logging.info(f"Đã chuẩn bị công thức tổng lãi/lỗ tại ô G{total_profit_loss_row}.")

        # --- Thêm phần tổng hợp số lượng đơn hàng theo loại sản phẩm ---
        summary_current_row = total_profit_loss_row + 2 # Bắt đầu sau 2 dòng trống từ dòng tổng lãi/lỗ

        # 1. Tổng số đơn hàng
        total_orders = len(orders_data_sorted)
        updates.append({
            'range': f'F{summary_current_row}:G{summary_current_row}',
            'values': [
                ["Tổng số đơn hàng:", total_orders]
            ]
        })
        logging.info(f"Đã chuẩn bị tổng số đơn hàng ({total_orders}).")
        summary_current_row += 1

        # 2. Phân loại theo mặt hàng theo tên mới
        item_counts = {}
        for order in orders_data_sorted:
            product_name = product_name_mapping_by_revenue.get(order['actual_revenue'], order['content'])
            item_counts[product_name] = item_counts.get(product_name, 0) + 1
            
        sorted_items = sorted(item_counts.items(), key=lambda item: item[1], reverse=True)

        summary_current_row += 1 # Thêm một dòng trống để tách
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

        # Thực hiện batch update tất cả các thay đổi
        if updates:
            worksheet.batch_update(updates, value_input_option='USER_ENTERED')
            logging.info(f"Đã thực hiện batch update cho sheet '{history_sheet_name}'.")
        else:
            logging.info(f"Không có cập nhật nào được chuẩn bị cho sheet '{history_sheet_name}'.")

        return True
    except Exception as e:
        logging.error(f"Lỗi khi cập nhật Google Sheet '{history_sheet_name}': {e}", exc_info=True)
        return False

def update_monthly_yearly_summary_sheet(orders_data, spreadsheet_name, summary_sheet_name, credentials_path):
    """
    Cập nhật sheet tổng hợp doanh thu theo tháng/năm.
    """
    try:
        gc = gspread.service_account(filename=credentials_path)
        sh = gc.open(spreadsheet_name)
        # Tạo hoặc lấy sheet
        try:
            worksheet = sh.worksheet(summary_sheet_name)
            logging.info(f"Đã tìm thấy sheet '{summary_sheet_name}'.")
        except gspread.exceptions.WorksheetNotFound:
            worksheet = sh.add_worksheet(title=summary_sheet_name, rows="100", cols="10")
            logging.info(f"Đã tạo mới sheet '{summary_sheet_name}'.")

        worksheet.clear() # Xóa dữ liệu cũ
        logging.info(f"Đã xóa dữ liệu cũ trên sheet '{summary_sheet_name}'.")

        # Chuẩn bị dữ liệu tổng hợp
        monthly_yearly_summary = defaultdict(lambda: {'total_orders': 0, 'total_revenue': 0, 'total_cost': 0, 'total_profit': 0})

        for order in orders_data:
            order_date = datetime.strptime(order['date'], "%Y-%m-%d %H:%M:%S")
            year_month = order_date.strftime("%Y-%m") # Định dạng YYYY-MM
            
            monthly_yearly_summary[year_month]['total_orders'] += 1
            monthly_yearly_summary[year_month]['total_revenue'] += order['actual_revenue']
            monthly_yearly_summary[year_month]['total_cost'] += order['actual_cost']
            monthly_yearly_summary[year_month]['total_profit'] += (order['actual_revenue'] - order['actual_cost'])
        
        # Sắp xếp dữ liệu theo thời gian
        sorted_summary_keys = sorted(monthly_yearly_summary.keys())

        # Chuẩn bị dữ liệu để ghi vào sheet
        summary_data_to_write = [['Tháng/Năm', 'Tổng số đơn hàng', 'Tổng Doanh thu', 'Tổng Giá vốn', 'Tổng Lãi/Lỗ']]
        for ym in sorted_summary_keys:
            data = monthly_yearly_summary[ym]
            summary_data_to_write.append([
                ym,
                data['total_orders'],
                data['total_revenue'],
                data['total_cost'],
                data['total_profit']
            ])
        
        if summary_data_to_write:
            end_row = len(summary_data_to_write)
            worksheet.update(
                range_name=f'A1:E{end_row}',
                values=summary_data_to_write,
                value_input_option='USER_ENTERED'
            )
            logging.info(f"Đã cập nhật {len(summary_data_to_write) - 1} dòng dữ liệu tổng hợp theo tháng/năm vào sheet '{summary_sheet_name}'.")
        else:
            worksheet.update(range_name='A1:E1', values=[['Tháng/Năm', 'Tổng số đơn hàng', 'Tổng Doanh thu', 'Tổng Giá vốn', 'Tổng Lãi/Lỗ']])
            logging.warning(f"Không có dữ liệu để tổng hợp theo tháng/năm vào sheet '{summary_sheet_name}'. Chỉ cập nhật tiêu đề.")
        
        return True
    except Exception as e:
        logging.error(f"Lỗi khi cập nhật Google Sheet '{summary_sheet_name}': {e}", exc_info=True)
        return False


# Hàm chính để GitHub Action gọi
if __name__ == '__main__':
    # Đọc cấu hình từ biến môi trường hoặc gán giá trị mặc định
    spreadsheet_name = os.getenv('GOOGLE_SHEET_NAME', 'Bao Cao Doanh Thu Thang')
    cookie_sheet_name = os.getenv('COOKIE_SHEET_NAME', 'Cookie_Config')
    lịch_sử_giao_dịch_sheet_name = os.getenv('TRANSACTION_HISTORY_SHEET_NAME', 'Lich Su Giao Dich')
    monthly_yearly_summary_sheet_name = os.getenv('MONTHLY_YEARLY_SUMMARY_SHEET_NAME', 'Bao Cao Tong Hop') # Tên sheet mới
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

        # 2. Lấy toàn bộ dữ liệu đơn hàng từ trang web (không lọc tháng)
        logging.info("Đang lấy toàn bộ dữ liệu đơn hàng từ trang web...")
        orders_data = get_orders_data_from_html(url_to_scrape, cookies_string)
        logging.info(f"Đã lấy được {len(orders_data)} đơn hàng.")

        # 3. Cập nhật dữ liệu vào Google Sheet 'Lich Su Giao Dich'
        logging.info(f"Đang cập nhật dữ liệu vào Google Sheet '{lịch_sử_giao_dịch_sheet_name}'...")
        if update_transaction_history_sheet(
            orders_data, spreadsheet_name, lịch_sử_giao_dịch_sheet_name,
            credentials_file_path
        ):
            logging.info(f"Cập nhật thành công sheet '{lịch_sử_giao_dịch_sheet_name}'!")
        else:
            logging.error(f"Có lỗi khi cập nhật sheet '{lịch_sử_giao_dịch_sheet_name}'. Vui lòng kiểm tra logs.")
            exit(1)

        # 4. Cập nhật dữ liệu vào Google Sheet 'Bao Cao Tong Hop' (mới)
        logging.info(f"Đang cập nhật dữ liệu vào Google Sheet '{monthly_yearly_summary_sheet_name}'...")
        if update_monthly_yearly_summary_sheet(
            orders_data, spreadsheet_name, monthly_yearly_summary_sheet_name,
            credentials_file_path
        ):
            logging.info(f"Cập nhật thành công sheet '{monthly_yearly_summary_sheet_name}'!")
        else:
            logging.error(f"Có lỗi khi cập nhật sheet '{monthly_yearly_summary_sheet_name}'. Vui lòng kiểm tra logs.")
            exit(1)

    except Exception as e:
        logging.critical(f"Đã xảy ra lỗi nghiêm trọng trong quá trình thực thi: {e}", exc_info=True)
        exit(1)
