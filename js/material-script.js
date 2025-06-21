const toggleBtn = document.getElementById("toggle-mode");
const searchBox = document.getElementById("search");
const siteTitle = document.getElementById("site-title");
const iframe = document.querySelector("iframe");
const navLinks = document.querySelectorAll(".bottom-nav a");

// Chuyển đổi chế độ sáng/tối mượt
toggleBtn.addEventListener("click", () => {
  document.body.classList.toggle("dark");
});

// Xử lý tìm kiếm
searchBox.addEventListener("input", (e) => {
  const keyword = e.target.value.toLowerCase();
  iframe.contentWindow.postMessage({ type: "search", keyword }, "*");
});

// Load iframe xong
iframe.addEventListener("load", () => {
  const url = iframe.contentWindow.location.href;
  const isHome = url.includes("home.html");

  // Hiện/ẩn thanh tìm kiếm hoặc tiêu đề trang
  searchBox.style.display = isHome ? "none" : "inline-block";
  siteTitle.style.display = isHome ? "inline-block" : "none";

  // Làm nổi bật tab active
  navLinks.forEach(link => {
    if (link.href === url) {
      // Thêm hiệu ứng mượt khi đổi tab
      link.classList.add("active");
      link.style.transition = "transform 0.4s ease";
    } else {
      link.classList.remove("active");
      link.style.transition = "transform 0.3s ease";
    }
  });
});
