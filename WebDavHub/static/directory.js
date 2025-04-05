// Prevent flash of unstyled content
(function() {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
})();

document.addEventListener('DOMContentLoaded', function() {
    // Theme toggle functionality
    const themeToggle = document.getElementById('theme-toggle');
    const htmlElement = document.documentElement;
    const moonIcon = '<i class="fas fa-moon"></i>';
    const sunIcon = '<i class="fas fa-sun"></i>';

    // Check for saved theme preference or use device preference
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        htmlElement.setAttribute('data-theme', 'dark');
        themeToggle.innerHTML = sunIcon;
    } else {
        htmlElement.setAttribute('data-theme', 'light');
        themeToggle.innerHTML = moonIcon;
    }

    // Toggle theme on button click
    themeToggle.addEventListener('click', function() {
        if (htmlElement.getAttribute('data-theme') === 'dark') {
            htmlElement.setAttribute('data-theme', 'light');
            localStorage.setItem('theme', 'light');
            themeToggle.innerHTML = moonIcon;
        } else {
            htmlElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
            themeToggle.innerHTML = sunIcon;
        }
    });

    // Options dropdown functionality
    const optionsButtons = document.querySelectorAll('.options-button');
    const detailsModal = document.getElementById('details-modal');
    const modalClose = document.querySelector('.modal-close');

    // Close all dropdowns function
    function closeAllDropdowns() {
        document.querySelectorAll('.options-dropdown').forEach(dropdown => {
            dropdown.classList.remove('show');
        });
    }

    // Position and show dropdown
    function positionDropdown(button, dropdown) {
        // Get button position
        const buttonRect = button.getBoundingClientRect();

        // Position dropdown relative to button
        dropdown.style.top = `${buttonRect.bottom + 5}px`;
        dropdown.style.left = `${buttonRect.right - dropdown.offsetWidth}px`;

        // Check if dropdown would go off-screen to the right
        if (buttonRect.right - dropdown.offsetWidth < 0) {
            dropdown.style.left = '0px';
        }

        // Check if dropdown would go off-screen to the bottom
        const dropdownHeight = dropdown.offsetHeight;
        if (buttonRect.bottom + dropdownHeight > window.innerHeight) {
            dropdown.style.top = `${buttonRect.top - dropdownHeight - 5}px`;
        }

        // Show the dropdown
        dropdown.classList.add('show');
    }

    // Options button click handler
    optionsButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();

            // Close any open dropdowns first
            closeAllDropdowns();

            // Toggle the dropdown
            const dropdown = this.nextElementSibling;
            dropdown.classList.toggle('show');
        });
    });

    // View details click handler
    document.querySelectorAll('.view-details').forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();

            // Get file/folder details from data attributes
            const name = this.getAttribute('data-name');
            const type = this.getAttribute('data-type');
            const size = this.getAttribute('data-size');
            const modified = this.getAttribute('data-modified');
            const path = this.getAttribute('data-path');
            const currentPath = document.querySelector('h1').textContent.replace('Files in ', '');

            // Populate the modal with details
            document.getElementById('detail-name').textContent = name;
            document.getElementById('detail-type').textContent = type.charAt(0).toUpperCase() + type.slice(1);
            document.getElementById('detail-size').textContent = size;
            document.getElementById('detail-modified').textContent = modified;
            document.getElementById('detail-path').textContent = path;
            document.getElementById('detail-full-path').textContent = '/mnt/temp/CineSync' + path;

            // Show the modal
            detailsModal.classList.add('show');

            // Close the dropdown
            closeAllDropdowns();
        });
    });

    // Close the modal when clicking the close button
    modalClose.addEventListener('click', function() {
        detailsModal.classList.remove('show');
    });

    // Close the modal when clicking outside of it
    detailsModal.addEventListener('click', function(e) {
        if (e.target === detailsModal) {
            detailsModal.classList.remove('show');
        }
    });

    // Close dropdowns when clicking elsewhere
    document.addEventListener('click', function(e) {
        // Only close dropdowns if click is not on an options button or its children
        if (!e.target.closest('.options-button')) {
            closeAllDropdowns();
        }
    });

    // Make sure file item links don't interfere with options
    document.querySelectorAll('.file-item').forEach(item => {
        const fileNameLink = item.querySelector('.file-name');
        const optionsButton = item.querySelector('.options-button');

        if (fileNameLink && optionsButton) {
            // Prevent event propagation from options button to file link
            optionsButton.addEventListener('click', function(e) {
                e.stopPropagation();
            });
        }
    });

    // Stop propagation for dropdown items
    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    });

    // Handle window resize to reposition any open dropdowns
    window.addEventListener('resize', function() {
        const openDropdown = document.querySelector('.options-dropdown.show');
        if (openDropdown) {
            const button = openDropdown.previousElementSibling;
            positionDropdown(button, openDropdown);
        }
    });
});
