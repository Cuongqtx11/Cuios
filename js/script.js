document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search');
    const searchIcon = document.getElementById('search-icon');
    const toggleModeButton = document.getElementById('toggle-mode');
    const contentFrame = document.querySelector('.content-frame');
    const bottomNavLinks = document.querySelectorAll('.bottom-nav a');
    const siteTitle = document.getElementById('site-title');

    // --- Dark Mode Toggle ---
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.body.classList.add(savedTheme);
        if (savedTheme === 'dark') {
            toggleModeButton.querySelector('.material-icons').textContent = 'light_mode';
        }
    }

    toggleModeButton.addEventListener('click', () => {
        document.body.classList.toggle('dark');
        let currentTheme = 'light';
        if (document.body.classList.contains('dark')) {
            currentTheme = 'dark';
            toggleModeButton.querySelector('.material-icons').textContent = 'light_mode';
        } else {
            toggleModeButton.querySelector('.material-icons').textContent = 'dark_mode';
        }
        localStorage.setItem('theme', currentTheme);

        // Send theme change message to current active iframe
        if (contentFrame.contentWindow) {
            contentFrame.contentWindow.postMessage({ type: 'themeChange', theme: currentTheme }, '*');
        }
    });

    // --- Search Functionality ---
    let searchTimeout;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const searchTerm = searchInput.value;
            // Only send search message if the current page in iframe is not home.html
            const currentIframeSrc = contentFrame.contentWindow.location.pathname;
            if (!currentIframeSrc.includes('home.html')) {
                if (contentFrame.contentWindow) {
                    contentFrame.contentWindow.postMessage({ type: 'search', keyword: searchTerm }, '*');
                }
            }
        }, 300); // Debounce search input
    });

    // --- Navigation Link Active State & Header Adjustments ---
    function updateHeaderForPage(pageUrl) {
        if (pageUrl.includes('home.html')) {
            searchInput.style.display = 'none';
            searchIcon.style.display = 'none';
            siteTitle.style.display = 'block';
        } else {
            searchInput.style.display = 'block';
            searchIcon.style.display = 'block';
            siteTitle.style.display = 'none';
            searchInput.value = ''; // Clear search input when changing page
        }
    }

    bottomNavLinks.forEach(link => {
        link.addEventListener('click', function(event) {
            bottomNavLinks.forEach(nav => nav.classList.remove('active'));
            this.classList.add('active');

            const targetPage = this.getAttribute('href');
            updateHeaderForPage(targetPage); // Update header immediately based on target

            contentFrame.onload = () => {
                const currentTheme = document.body.classList.contains('dark') ? 'dark' : 'light';
                contentFrame.contentWindow.postMessage({ type: 'themeChange', theme: currentTheme }, '*');
                contentFrame.onload = null; // Remove onload handler after first load
            };
        });
    });

    // Handle initial iframe load to sync theme and adjust header
    contentFrame.onload = () => {
        const currentTheme = document.body.classList.contains('dark') ? 'dark' : 'light';
        contentFrame.contentWindow.postMessage({ type: 'themeChange', theme: currentTheme }, '*');

        const initialIframeSrc = contentFrame.contentWindow.location.pathname;
        updateHeaderForPage(initialIframeSrc); // Adjust header based on initial loaded page

        contentFrame.onload = null; // Remove onload handler after initial load
    };

    // Initial header adjustment based on the default loaded page (home.html)
    updateHeaderForPage(contentFrame.src);
});