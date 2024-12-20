<html>
    <head>
        <title>Encode Sales</title>
        <link rel="stylesheet" type="text/css" href="../stylesheets/base.css">
        <link rel="stylesheet" type="text/css" href="../stylesheets/encode-sales.css">
    </head>
    <body>
        {{!-- Header --}}
        <div class="header-div">
            <img class="logo" src="../images/logo.png">
            <div class="flex center">
                <ul>
                    <li><a class="header-divider">|</a></li>
                    <li><a class="header-button" href="/home">Home</a></li>
                    <li><a class="header-divider">></a></li>
                    <li><a class="header-button on-page">Encode Sales</a></li>
                </ul>
            </div>
            <div class="sign-out">
                <div>
                    <span>{{ user }}</span> <br />
                    <a class="sign-out-button" href="/">Sign Out</a>
                </div>
            </div>
        </div>
        <div class="body-div">
            <div class="item-select flex column center">
                <div class="price-display" tabindex="-1">
                    ZZZZ
                </div>
                <div class="select-table-container">
                    <table class="select-table">
                        <thead>
                            <tr>
                                <th class="select-description">Description</th>
                                <th class="select-price">Price</th>
                                <th class="select-code">Item Code</th>
                            </tr>
                        </thead>
                        <tbody>
                            {{#each plu}}
                                <tr>
                                    <td class="select-description">{{ itemName }}</td>
                                    <td class="select-price">{{ price }}</td>
                                    <td class="select-code">{{ itemId }}</td>
                                </tr>
                            {{/each}}
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="flex column table-container">   
                <span class="title-card">Encode Sales</span>
                <form id="sale-form" action="/save-sale" method="post">
                    <div class="si-container">
                        Discount: <input name="discount" type="text" placeholder="20">
                        Discount Remarks: <input name="remarks" type="text" placeholder="Remarks">
                        SI <input name="saleId" type="text" placeholder="SI Number"> 

                        <button class="save-sale" type="submit">
                            Save Sale
                        </button>
                    </div>
                    <table class="encode-table">
                        <thead>
                            <tr>
                                <th class="quantity">Qty</th>
                                <th class="name">Description</th>
                                <th class="price">Unit Price</th>
                                <th class="discount">Apply Discount</th>
                                <th class="amount">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr class="table-footer">
                                <td></td>
                                <td colspan="2">
                                </td>
                                <td class="discount">Total :</td>
                                <td class="sale-total amount">₱ 0.00</td>
                            </tr>
                        </tbody>
                    </table>
                </form>
            </div>
        </div>
    </body>
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
        let lastFocusedRow = null; 

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

            let amountInput = amountCell.querySelector('input[type="hidden"]');
            if (amountInput) {
                amountInput.value = amount.toFixed(2);
            } else {
                amountInput = document.createElement('input');
                amountInput.type = 'hidden';
                amountInput.name = `items[${row.getAttribute('row-num-data')}][amount]`;
                amountInput.value = amount.toFixed(2);
                amountCell.appendChild(amountInput);
            }
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
            const existingRow = Array.from(encodeTableBody.querySelectorAll('tr')).find(row => {
                const nameCell = row.querySelector('.name');
                return nameCell && nameCell.textContent === itemName;
            });

            if (existingRow) {
                const quantityCell = existingRow.querySelector('.quantity');
                let quantity = parseInt(quantityCell.textContent, 10) || 0;
                quantity += 1;
                quantityCell.textContent = quantity;

                existingRow.querySelector(`input[name="items[${existingRow.getAttribute('row-num-data')}][quantity]"]`).value = quantity;

                updateRowAmount(existingRow);
                updateTotalAmount();

                existingRow.focus();
                lastFocusedRow = existingRow; 

                return existingRow;
            } else {
                const newRow = document.createElement('tr');
                const rowCount = encodeTableBody.querySelectorAll('tr[row-num-data]').length;

                newRow.setAttribute('row-num-data', rowCount);
                newRow.innerHTML = `
                    <td class="quantity">
                        1 <input  type="hidden" name="items[${rowCount}][quantity]" value="1" />
                    </td>
                    <td class="name">
                        ${itemName} <input type="hidden" name="items[${rowCount}][name]" value="${itemName}" />
                    </td>
                    <td class="price">
                        ${parseFloat(itemPrice).toFixed(2)} <input type="hidden" name="items[${rowCount}][price]" value="${parseFloat(itemPrice).toFixed(2)}" />
                    </td>
                    <td class="discount">
                        <div class="flex center">
                            <div class="checkbox-wrapper-2">
                                <input type="checkbox" name="items[${rowCount}][discount]" class="sc-gJwTLC ikxBAC">
                            </div>
                        </div>
                    </td>
                    <td class="amount">
                        ${parseFloat(itemPrice).toFixed(2)} <input type="hidden" name="items[${rowCount}][amount]" value="${parseFloat(itemPrice).toFixed(2)}" />
                    </td>
                `;

                encodeTableBody.insertBefore(newRow, encodeTableBody.lastElementChild); 
                updateRowAmount(newRow);
                updateTotalAmount();

                newRow.setAttribute("tabindex", "0");
                newRow.addEventListener("keydown", handleRowKeyEvents);
                newRow.addEventListener("focus", () => {
                    lastFocusedRow = newRow; 
                });

                const discountCheckbox = newRow.querySelector('.discount input[type="checkbox"]');
                discountCheckbox.addEventListener("mousedown", function () {
                    discountCheckbox.addEventListener("change", function () {
                        updateRowAmount(newRow);
                        updateTotalAmount();

                        lastFocusedRow.focus();
                    }, { once: true });
                });

                return newRow;
            }
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
            if (key === 'Backspace') {
                const previousRow = row.previousElementSibling;
                const nextRow = row.nextElementSibling;

                row.remove();
                updateTotalAmount();

                if (previousRow) {
                    previousRow.focus();
                } else if (nextRow) {
                    nextRow.focus();
                }

                event.preventDefault();
            }
        }

        discountInput.addEventListener("input", function () {
    // Remove any non-digit characters and enforce maximum two digits
    discountInput.value = discountInput.value.replace(/\D/g, '').slice(0, 2);

    // If the first character is '0', remove it
    if (discountInput.value.startsWith('0')) {
        discountInput.value = discountInput.value.slice(1);
    }

    const rows = encodeTableBody.querySelectorAll('tr[row-num-data]');
    rows.forEach(row => updateRowAmount(row));
    updateTotalAmount();
});

        
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
                    const newRow = addItemToEncodeTable(itemName, itemPrice, itemId);

                    newRow.focus();

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

                    function removeSpecialCharacters(str) {
                        return str.replace(/[^a-zA-Z0-9]/g, "");
                    }

                    for (let i = 0; i < pluRows.length; i++) {
                        const descriptionCell = pluRows[i].querySelector(".select-description");
                        if (descriptionCell) {
                            const cleanDescription = removeSpecialCharacters(descriptionCell.textContent.toLowerCase());
                            const cleanSearchBuffer = removeSpecialCharacters(searchBuffer);
                            if (cleanDescription.startsWith(cleanSearchBuffer)) {
                                pluRows[i].focus();
                                break;
                            }
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

        document.addEventListener("focusout", function () {
            setTimeout(() => {
                if (!document.activeElement || document.activeElement === document.body) {
                    if (lastFocusedRow) lastFocusedRow.focus();
                }
            }, 0);
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

</html>