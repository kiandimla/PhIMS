<script>
    document.addEventListener("DOMContentLoaded", function () {
        const discountInput = document.querySelector('input[name="discount"]');
        const saleTotalCell = document.querySelector('.sale-total.amount');
        const pluRows = document.querySelectorAll(".select-table tbody tr");
        const priceDisplay = document.querySelector(".price-display");
        const encodeTableBody = document.querySelector('.encode-table tbody');
        const itemSelect = document.querySelector(".item-select");
        const tableContainer = document.querySelector(".table-container");
        let searchBuffer = "";
        let searchTimeout;

        itemSelect.style.visibility = "hidden";

        function getDiscountRate() {
            const discountValue = parseFloat(discountInput.value) || parseFloat(discountInput.placeholder);
            return discountValue / 100;
        }

        function updateRowAmount(row) {
            const quantityCell = row.querySelector('.quantity');
            const priceCell = row.querySelector('.price');
            const amountCell = row.querySelector('.amount');
            const discountCheckbox = row.querySelector('.discount input[type="checkbox"]');
            const quantity = parseInt(quantityCell.textContent, 10) || 0;
            const unitPrice = parseFloat(priceCell.textContent) || 0;
            const discountRate = discountCheckbox.checked ? getDiscountRate() : 0;
            const amount = quantity * unitPrice * (1 - discountRate);
            amountCell.textContent = amount.toFixed(2);
        }

        function updateTotalAmount() {
            const rows = encodeTableBody.querySelectorAll('tr[row-num-data]');
            let total = 0;
            rows.forEach(row => {
                const amountCell = row.querySelector('.amount');
                const amount = parseFloat(amountCell.textContent) || 0;
                total += amount;
            });
            saleTotalCell.textContent = "₱ " + total.toFixed(2);
        }

        function addItemToEncodeTable(itemName, itemPrice, itemId) {
            const newRow = document.createElement('tr');
            const rowCount = encodeTableBody.querySelectorAll('tr[row-num-data]').length + 1;
            
            newRow.setAttribute('row-num-data', rowCount);
            newRow.innerHTML = `
                <td class="quantity">1</td>
                <td class="name">${itemName}</td>
                <td class="price">${parseFloat(itemPrice).toFixed(2)}</td>
                <td class="discount">
                    <div class="flex center">
                        <div class="checkbox-wrapper-2">
                            <input type="checkbox" class="sc-gJwTLC ikxBAC">
                        </div>
                    </div>
                </td>
                <td class="amount">${parseFloat(itemPrice).toFixed(2)}</td>
            `;

            encodeTableBody.insertBefore(newRow, encodeTableBody.lastElementChild); 
            updateRowAmount(newRow);
            updateTotalAmount();

            newRow.setAttribute("tabindex", "0");
            newRow.addEventListener("keydown", handleRowKeyEvents);
            const discountCheckbox = newRow.querySelector('.discount input[type="checkbox"]');
            discountCheckbox.addEventListener("mousedown", function () {
                discountCheckbox.addEventListener("change", function () {
                    updateRowAmount(newRow);
                    updateTotalAmount();
                }, { once: true });
            });
        }

        function handleRowKeyEvents(event) {
            const row = event.currentTarget;
            const key = event.key;
            
            if (key === 'ArrowDown' || key === 'ArrowUp') {
                event.preventDefault();
                const rows = encodeTableBody.querySelectorAll('tr[row-num-data]');
                const index = Array.from(rows).indexOf(row);
                if (key === 'ArrowDown' && index < rows.length - 1) rows[index + 1].focus();
                if (key === 'ArrowUp' && index > 0) rows[index - 1].focus();
            }
            if (key.toLowerCase() === 'q' || key.toLowerCase() === 'a') {
                const quantityCell = row.querySelector('.quantity');
                let quantity = parseInt(quantityCell.textContent, 10) || 0;
                if (key === 'q') quantity += 1;
                else if (key === 'a') quantity = Math.max(0, quantity - 1);
                quantityCell.textContent = quantity;
                updateRowAmount(row);
                updateTotalAmount();
                event.preventDefault();
            }
        }

        pluRows.forEach((row, index) => {
            row.setAttribute("tabindex", "0");
            row.addEventListener("focus", function () {
                const priceCell = row.querySelector(".select-price");
                if (priceCell) priceDisplay.textContent = "₱ " + priceCell.textContent;
            });
            row.addEventListener("keydown", function (event) {
                const key = event.key;
                if (key === "ArrowDown" && index < pluRows.length - 1) {
                    pluRows[index + 1].focus();
                    event.preventDefault();
                } else if (key === "ArrowUp" && index > 0) {
                    pluRows[index - 1].focus();
                    event.preventDefault();
                }
                if (key === "Enter") { 
                    const itemName = row.querySelector(".select-description").textContent;
                    const itemPrice = row.querySelector(".select-price").textContent;
                    const itemId = row.querySelector(".select-code").textContent;
                    addItemToEncodeTable(itemName, itemPrice, itemId);

                    itemSelect.style.visibility = "hidden";
                    tableContainer.style.filter = "none";

                    event.preventDefault();
                    event.stopPropagation();
                }
                if (key.length === 1) {
                    searchBuffer += key.toLowerCase();
                    if (searchTimeout) clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(() => {
                        searchBuffer = "";
                    }, 500);
                    for (let i = 0; i < pluRows.length; i++) {
                        const descriptionCell = pluRows[i].querySelector(".select-description");
                        if (descriptionCell && descriptionCell.textContent.toLowerCase().startsWith(searchBuffer)) {
                            pluRows[i].focus();
                            break;
                        }
                    }
                }
            });
        });

        document.addEventListener("keydown", function(event) {
            if (event.key === "Enter") {
                itemSelect.style.visibility = "visible";
                tableContainer.style.filter = "blur(3px)";
                const firstPluRow = document.querySelector(".select-table tbody tr");
                if (firstPluRow) firstPluRow.focus();
            } else if (event.key === "Backspace") {
                itemSelect.style.visibility = "hidden";
                tableContainer.style.filter = "none";

            }
        });

        document.querySelectorAll('.select-table tbody tr').forEach(row => {
        row.addEventListener('focus', (event) => {
            event.target.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'nearest'
            });
        });
    });
});
</script>