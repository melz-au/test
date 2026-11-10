import Nav from '../components/Nav'
import useBodyClass from '../components/useBodyClass'

export default function About() {
  useBodyClass('body-6')

  return (
    <>
      <Nav />
      <section className="section-11">
        <div className="w-layout-blockcontainer container-21 w-container">
          <div className="rich-text-block-7 w-richtext">
            <h1 className="heading-16">About</h1>
            <p>I&apos;m a Data &amp; AI Leader living and working in Adelaide, South Australia.</p>
            <p>
              I have diverse experience across large enterprise including critical infrastructure, and startups
              operating in B2B and B2C target markets.
            </p>
            <p>
              I am a strategic thinker who thrives on the challenge of reducing time to value for customers, users and
              stakeholders. I partner with executives, facilitating strategic workshops, planning roadmaps and backlogs
              to execute on multiyear programs of work.
            </p>
            <p>
              My primary focus is on the realisation of business benefits. While I am a data and AI strategic leader, I
              advocate for human-centred design in all that I do. I balance risk mitigation and innovation, always
              looking for safe solutions that create efficiencies for businesses and employees.
            </p>
            <p>
              A great deal of my work has involved designing user interfaces for AI products, delivering actionable
              insights and recommendations. I am a technologist at heart, always focused on the future, continuously
              learning and looking for new ways to provide business value.
            </p>
            <p>
              An empathetic leader, I seek to understand customer and user experience through the collection and
              analysis of qualitative and quantitative data to reveal insights about capabilities and potential
              optimisations.
            </p>
            <p>
              In my spare time I am constantly learning. I love reading - mainly about technology, behavioural
              economics, and science fiction. I love oil painting, playing Music League, cooking and spending time with
              family.
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
