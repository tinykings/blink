document.addEventListener('DOMContentLoaded', () => {
    // Toggle for summaries
    document.body.addEventListener('click', (e) => {
        if (e.target.classList.contains('toggle-summary-btn')) {
            const targetId = e.target.getAttribute('data-target');
            const summaryDiv = document.getElementById(targetId);

            if (summaryDiv) {
                summaryDiv.style.display = summaryDiv.style.display === 'none' ? 'block' : 'none';
            }
        }
    });

    // Toggle for day sections
    document.body.addEventListener('click', (e) => {
        if (e.target.classList.contains('toggle-day-btn')) {
            const targetId = e.target.getAttribute('data-target');
            const contentDiv = document.getElementById(targetId);

            if (contentDiv) {
                const isHidden = contentDiv.style.display === 'none';
                contentDiv.style.display = isHidden ? 'block' : 'none';
                e.target.textContent = isHidden ? '-' : '+';
            }
        }
    });
});
