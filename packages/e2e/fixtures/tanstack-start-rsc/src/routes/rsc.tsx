import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  CompositeComponent,
  createCompositeComponent,
  renderServerComponent,
} from '@tanstack/react-start/rsc'
import { env } from 'cloudflare:workers'
import { Counter } from '~/components/Counter'

function Greeting() {
  return (
    <div>
      <h3>Hello from RSC</h3>
      <p>{`Rendered in ${navigator.userAgent}: ${env.MY_VAR}`}</p>
      <Counter label="Server component's counter" />
    </div>
  )
}

const getGreeting = createServerFn().handler(async () => {
  const Renderable = await renderServerComponent(<Greeting />)
  return { Renderable }
})

const getCard = createServerFn().handler(async () => {
  const src = await createCompositeComponent(
    (props: { children?: React.ReactNode }) => (
      <div className="card">
        <h3>Server-rendered header</h3>
        <div>{props.children}</div>
      </div>
    ),
  )

  return { src }
})

export const Route = createFileRoute('/rsc')({
  loader: async () => {
    const [{ Renderable }, Card] = await Promise.all([getGreeting(), getCard()])
    return { Greeting: Renderable, Card }
  },
  component: RscPage,
})

function RscPage() {
  const { Greeting, Card } = Route.useLoaderData()

  return (
    <div className="p-2">
      {Greeting}
      <CompositeComponent src={Card.src}>
        <Counter label="Slot's counter" />
      </CompositeComponent>
    </div>
  )
}
