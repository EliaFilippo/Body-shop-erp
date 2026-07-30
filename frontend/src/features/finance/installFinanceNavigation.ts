const financeIcon = `
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 10h18M5 10v9m4-9v9m6-9v9m4-9v9M2 21h20M12 3 3 8h18l-9-5Z" />
  </svg>
`

export function installFinanceNavigation() {
  const addFinanceButton = () => {
    const navigation = document.querySelector('.sidebar nav')
    if (!navigation || navigation.querySelector('[data-finance-navigation]')) return

    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.financeNavigation = 'true'
    button.innerHTML = `${financeIcon}<span>Finanza</span>`
    button.addEventListener('click', () => {
      window.location.assign('/finance.html')
    })
    navigation.appendChild(button)
  }

  addFinanceButton()

  const observer = new MutationObserver(addFinanceButton)
  observer.observe(document.body, { childList: true, subtree: true })

  return () => observer.disconnect()
}
